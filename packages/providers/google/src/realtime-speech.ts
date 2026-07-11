/**
 * Gemini Live speech-to-speech adapter (RFC 0001, experimental).
 *
 * Bridges the Gemini Live API (BidiGenerateContent WebSocket) to the
 * provider-agnostic RealtimeSpeechSession interface: 16kHz PCM up, 24kHz
 * PCM down, native transcripts, provider-driven barge-in (interrupted),
 * tool calls with cancellation, and adapter-internal reconnection with
 * session resumption across Gemini's ~10-minute socket lifetime -
 * including bounded input-audio buffering so user speech spanning a
 * reconnect is not clipped.
 *
 * Gemini Live is a preview API; this adapter is experimental. Wire
 * shapes marked LIVE-PROBE below must be confirmed against the real API
 * before playbooks-on-Gemini are promoted from experimental.
 */

import WebSocket from 'ws';
import {
  AsyncEventQueue,
  RealtimeSpeechConfig,
  RealtimeSpeechEvent,
  RealtimeSpeechProvider,
  RealtimeSpeechSession,
  RealtimeUsage,
  ToolDefinition
} from '@llmrtc/llmrtc-core';

export interface GeminiLiveSpeechOptions {
  /** Google AI API key */
  apiKey: string;
  /** Live-capable model (default: 'gemini-3.1-flash-live-preview') */
  model?: string;
  /** WebSocket URL override (tests) */
  url?: string;
  /** Connect timeout per attempt in ms (default: 10000) */
  connectTimeoutMs?: number;
  /** Max buffered input audio during a reconnect, in bytes (default: 64000 = 2s at 16kHz) */
  reconnectBufferBytes?: number;
  /** Reconnect attempt backoff in ms (default: [250, 1000, 2000]) */
  reconnectBackoffMs?: number[];
  /** Diagnostics sink (default: console) */
  logger?: Pick<Console, 'warn' | 'error'>;
}

const DEFAULT_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

interface GeminiServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: {
    promptTokenCount?: number;
    responseTokenCount?: number;
    responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
  };
}

function mapTools(tools: ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }
  ];
}

function buildSetup(model: string, config: RealtimeSpeechConfig, handle?: string): Record<string, unknown> {
  const tools = mapTools(config.tools);
  const setup: Record<string, unknown> = {
    model: model.startsWith('models/') ? model : `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      ...(config.maxOutputTokens !== undefined && { maxOutputTokens: config.maxOutputTokens }),
      ...(config.voice && {
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } }
      })
    },
    ...(config.instructions && {
      systemInstruction: { parts: [{ text: config.instructions }] }
    }),
    ...(tools && { tools }),
    ...(config.inputTranscription !== false && { inputAudioTranscription: {} }),
    outputAudioTranscription: {},
    // Compression lifts the 15-minute audio-session cap (RFC 0001 §2);
    // always on in relay mode
    contextWindowCompression: {
      slidingWindow: {},
      ...(config.contextManagement?.triggerTokens && {
        triggerTokens: config.contextManagement.triggerTokens
      })
    },
    sessionResumption: handle ? { handle } : {}
  };
  if (config.turnDetection?.type === 'server_vad') {
    setup.realtimeInputConfig = {
      automaticActivityDetection: {
        ...(config.turnDetection.silenceDurationMs !== undefined && {
          silenceDurationMs: config.turnDetection.silenceDurationMs
        })
      }
    };
  }
  return setup;
}

class GeminiLiveSpeechSession implements RealtimeSpeechSession {
  readonly inputSampleRate = 16000;
  readonly outputSampleRate = 24000;

  private readonly queue = new AsyncEventQueue<RealtimeSpeechEvent>();
  private ws: WebSocket;
  private ready = false;
  private everReady = false;
  private closed = false;
  private reconnecting = false;
  private reconnectPromise: Promise<void> = Promise.resolve();
  private setupWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private resumptionHandle: string | null = null;
  private handleConsumed = false;
  private lastCloseInfo = '';
  private turnCounter = 0;
  private currentResponseId: string | null = null;
  private userRunningText = '';
  private assistantRunningText = '';
  private lastUsage: RealtimeUsage | undefined;
  private readonly toolNames = new Map<string, string>();
  // Input frames + tool results buffered while a reconnect is in flight
  private reconnectBuffer: Buffer[] = [];
  private reconnectBufferedBytes = 0;
  private pendingToolResults: string[] = [];
  private readonly logger: Pick<Console, 'warn' | 'error'>;

  constructor(
    ws: WebSocket,
    private readonly options: {
      url: string;
      apiKey: string;
      model: string;
      config: RealtimeSpeechConfig;
      connectTimeoutMs: number;
      reconnectBufferBytes: number;
      reconnectBackoffMs: number[];
      logger?: Pick<Console, 'warn' | 'error'>;
    }
  ) {
    this.ws = ws;
    this.logger = options.logger ?? console;
    this.attach(ws);
  }

  private attach(ws: WebSocket): void {
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
    ws.on('error', (err: Error) => {
      this.lastCloseInfo = err.message;
      if (!this.closed && !this.reconnecting) {
        this.startReconnect(`socket error: ${err.message}`);
      }
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.lastCloseInfo = `close ${code}${reason?.length ? `: ${reason.toString()}` : ''}`;
      if (this.closed || this.reconnecting) return;
      if (!this.everReady) {
        // Setup was rejected (bad model/auth/config): fail fast with the
        // server's close reason instead of retrying a deterministic error
        this.failSetup(new Error(`Gemini Live setup rejected (${this.lastCloseInfo})`));
        this.queue.fail(new Error(`Gemini Live setup rejected (${this.lastCloseInfo})`));
        return;
      }
      this.startReconnect(this.lastCloseInfo);
    });
  }

  /** Resolves once the server acknowledged setup (setupComplete). */
  waitUntilReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.setupWaiter = null;
        reject(new Error(`setupComplete timed out (last close: ${this.lastCloseInfo || 'n/a'})`));
      }, this.options.connectTimeoutMs);
      timer.unref?.();
      this.setupWaiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        }
      };
    });
  }

  private failSetup(err: Error): void {
    const waiter = this.setupWaiter;
    this.setupWaiter = null;
    waiter?.reject(err);
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: GeminiServerMessage;
    try {
      msg = JSON.parse(data.toString()) as GeminiServerMessage;
    } catch {
      return;
    }
    if (msg.setupComplete) {
      this.ready = true;
      this.everReady = true;
      const waiter = this.setupWaiter;
      this.setupWaiter = null;
      waiter?.resolve();
      this.flushBuffers();
      return;
    }
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
      this.handleConsumed = false;
      return;
    }
    if (msg.goAway) {
      // Adapter-internal recovery (RFC 0001 §8); informational upstream
      this.queue.push({ type: 'session-expiring', inMs: parseDuration(msg.goAway.timeLeft) });
      this.startReconnect('goAway');
      return;
    }
    if (msg.usageMetadata) {
      this.lastUsage = mapUsage(msg.usageMetadata);
    }
    if (msg.toolCall?.functionCalls) {
      for (const call of msg.toolCall.functionCalls) {
        if (call.id && call.name) this.toolNames.set(call.id, call.name);
        this.queue.push({
          type: 'tool-call',
          callId: call.id ?? '',
          name: call.name ?? '',
          arguments: call.args ?? {}
        });
      }
      return;
    }
    if (msg.toolCallCancellation?.ids) {
      this.queue.push({ type: 'tool-call-cancelled', callIds: msg.toolCallCancellation.ids });
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      // Preserve what the user actually heard in the mirrored history,
      // then close the turn so clients never dangle in "speaking"
      this.finishTurn(true);
      return;
    }
    if (sc.inputTranscription?.text) {
      this.userRunningText += sc.inputTranscription.text;
      this.queue.push({ type: 'user-transcript', text: this.userRunningText, isFinal: false });
    }
    if (sc.outputTranscription?.text) {
      this.assistantRunningText += sc.outputTranscription.text;
      this.queue.push({ type: 'assistant-transcript', text: this.assistantRunningText, isFinal: false });
    }
    const parts = sc.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (!part.inlineData?.data) continue;
      if (!this.currentResponseId) {
        this.currentResponseId = `turn-${++this.turnCounter}`;
        this.queue.push({ type: 'response-started', responseId: this.currentResponseId });
        // A model turn implies the user's utterance ended
        if (this.userRunningText) {
          this.queue.push({ type: 'user-transcript', text: this.userRunningText, isFinal: true });
          this.userRunningText = '';
        }
      }
      this.queue.push({
        type: 'audio',
        pcm: Buffer.from(part.inlineData.data, 'base64'),
        sampleRate: this.outputSampleRate,
        responseId: this.currentResponseId
      });
    }
    if (sc.turnComplete) {
      this.finishTurn(false);
    }
  }

  /**
   * Close the current model turn: final assistant transcript, an
   * 'interrupted' signal when applicable, and response-done - so
   * orchestrator/client turn state never dangles, and interrupted
   * speech still reaches the mirrored history.
   */
  private finishTurn(interrupted: boolean): void {
    if (this.assistantRunningText) {
      this.queue.push({ type: 'assistant-transcript', text: this.assistantRunningText, isFinal: true });
      this.assistantRunningText = '';
    }
    if (interrupted) {
      this.queue.push({ type: 'interrupted' });
    }
    if (this.currentResponseId) {
      this.queue.push({
        type: 'response-done',
        responseId: this.currentResponseId,
        usage: this.lastUsage
      });
      this.currentResponseId = null;
      this.lastUsage = undefined;
    }
  }

  private startReconnect(reason: string): void {
    if (this.closed || this.reconnecting) return;
    this.reconnectPromise = this.reconnect(reason);
  }

  /** Reconnect with session resumption; buffers input audio meanwhile. */
  private async reconnect(reason: string): Promise<void> {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.ready = false;
    // A mid-drop model turn never gets turnComplete: close it now so
    // downstream turn state doesn't dangle across the resume
    this.finishTurn(false);
    const oldWs = this.ws;
    // Keep draining trailing messages (a final resumption handle, tail
    // audio) while the replacement connects; drop lifecycle handlers so
    // the old close can't trigger a second reconnect
    oldWs.removeAllListeners('error');
    oldWs.removeAllListeners('close');
    oldWs.on('error', () => {});
    const drainTimer = setTimeout(() => {
      try {
        oldWs.terminate();
      } catch {
        // already dead
      }
    }, 1500);
    drainTimer.unref?.();

    const backoffs = this.options.reconnectBackoffMs;
    let lastError: Error = new Error('no attempts made');
    for (let attempt = 0; attempt <= backoffs.length; attempt++) {
      if (this.closed) return;
      try {
        // A resumption handle is single-use: after a consumed-handle
        // failure, fall back to a fresh session (transcript continuity)
        const handle = this.handleConsumed ? undefined : (this.resumptionHandle ?? undefined);
        const ws = await openGeminiSocket(this.options.url, this.options.apiKey, this.options.connectTimeoutMs);
        if (this.closed) {
          ws.terminate();
          return;
        }
        this.ws = ws;
        this.attach(ws);
        if (handle) this.handleConsumed = true;
        ws.send(JSON.stringify({ setup: buildSetup(this.options.model, this.options.config, handle) }));
        await this.waitUntilReady();
        this.reconnecting = false;
        this.flushBuffers();
        this.logger.warn(
          `[gemini-live] reconnected (${reason})${handle ? ' with resumption' : ' without resumption'}`
        );
        if (!handle) {
          this.queue.push({
            type: 'error',
            error: new Error(`Gemini Live reconnected without a resumption handle (${reason})`),
            recoverable: true
          });
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        try {
          this.ws.terminate();
        } catch {
          // no socket to clean
        }
        if (attempt < backoffs.length && !this.closed) {
          await new Promise((r) => {
            const t = setTimeout(r, backoffs[attempt]);
            t.unref?.();
          });
        }
      }
    }
    this.reconnecting = false;
    if (!this.closed) {
      this.queue.fail(new Error(`Gemini Live reconnect failed (${reason}): ${lastError.message}`));
    }
  }

  events(): AsyncIterable<RealtimeSpeechEvent> {
    return this.queue;
  }

  sendAudio(frame: Buffer): void {
    if (this.closed || frame.length === 0) return;
    if (this.reconnecting || !this.ready || this.ws.readyState !== WebSocket.OPEN) {
      // Bounded buffer (default ~2s); oldest audio is dropped first
      this.reconnectBuffer.push(frame);
      this.reconnectBufferedBytes += frame.length;
      let dropped = 0;
      while (this.reconnectBufferedBytes > this.options.reconnectBufferBytes && this.reconnectBuffer.length > 1) {
        const evicted = this.reconnectBuffer.shift()!;
        this.reconnectBufferedBytes -= evicted.length;
        dropped += evicted.length;
      }
      if (dropped > 0) {
        this.logger.warn(`[gemini-live] reconnect buffer overflow: dropped ${dropped} bytes of input audio`);
      }
      return;
    }
    this.sendFrame(frame);
  }

  private flushBuffers(): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    for (const frame of this.reconnectBuffer) {
      this.sendFrame(frame);
    }
    this.reconnectBuffer = [];
    this.reconnectBufferedBytes = 0;
    for (const payload of this.pendingToolResults) {
      this.ws.send(payload);
    }
    this.pendingToolResults = [];
  }

  private sendFrame(frame: Buffer): void {
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: frame.toString('base64'), mimeType: `audio/pcm;rate=${this.inputSampleRate}` }
        }
      })
    );
  }

  cancelResponse(): void {
    // Gemini barge-in is provider-driven (serverContent.interrupted);
    // there is no client cancel primitive. Safe no-op per the interface.
  }

  sendToolResult(callId: string, output: unknown): void {
    if (this.closed) return;
    const payload = JSON.stringify({
      toolResponse: {
        functionResponses: [
          {
            id: callId,
            // LIVE-PROBE: FunctionResponse documents a name field
            ...(this.toolNames.has(callId) && { name: this.toolNames.get(callId) }),
            response:
              typeof output === 'object' && output !== null
                ? (output as Record<string, unknown>)
                : { result: output }
          }
        ]
      }
    });
    if (this.reconnecting || !this.ready || this.ws.readyState !== WebSocket.OPEN) {
      // The model waits on function responses - deliver after resume
      this.pendingToolResults.push(payload);
      return;
    }
    this.ws.send(payload);
  }

  async update(config: Partial<RealtimeSpeechConfig>): Promise<void> {
    if (this.closed) throw new Error('Gemini Live session is closed');
    const toolsChanged =
      config.tools !== undefined &&
      JSON.stringify(config.tools) !== JSON.stringify(this.options.config.tools);
    // Merge into the config used for future reconnects
    Object.assign(this.options.config, config);
    if (this.reconnecting) {
      // The in-flight reconnect's setup reads the merged config - the
      // change applies with it, no extra work needed
      await this.reconnectPromise;
      return;
    }
    if (toolsChanged) {
      // Setup is connect-time only: tool-set changes require a
      // resumption reconnect (RFC 0001 §2). Wait briefly for turn
      // quiescence so an active answer isn't chopped mid-word.
      const deadline = Date.now() + 10000;
      while (this.currentResponseId && Date.now() < deadline && !this.closed) {
        await new Promise((r) => {
          const t = setTimeout(r, 100);
          t.unref?.();
        });
      }
      this.startReconnect('tool-set update');
      await this.reconnectPromise;
      return;
    }
    if (config.instructions && this.ws.readyState === WebSocket.OPEN) {
      // LIVE-PROBE: documented cheaper path for instruction-only changes
      // is a system-role text turn; fall back to a prefixed user turn if
      // the live API rejects the role
      this.ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'system', parts: [{ text: config.instructions }] }],
            turnComplete: false
          }
        })
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failSetup(new Error('session closed'));
    this.queue.end();
    // An in-flight reconnect checks `closed` after connecting and
    // terminates its own socket; await it so nothing outlives us
    await this.reconnectPromise.catch(() => {});
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.terminate();
    }
  }
}

function mapUsage(u: NonNullable<GeminiServerMessage['usageMetadata']>): RealtimeUsage {
  const audioOf = (details?: Array<{ modality?: string; tokenCount?: number }>) =>
    details?.find((d) => d.modality === 'AUDIO')?.tokenCount;
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.responseTokenCount ?? 0,
    audioInputTokens: audioOf(u.promptTokensDetails),
    audioOutputTokens: audioOf(u.responseTokensDetails)
  };
}

function parseDuration(d?: string): number | undefined {
  if (!d) return undefined;
  const seconds = parseFloat(d);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

function openGeminiSocket(url: string, apiKey: string, timeoutMs: number): Promise<WebSocket> {
  const wsUrl = new URL(url);
  if (!wsUrl.searchParams.has('key')) {
    wsUrl.searchParams.set('key', apiKey);
  }
  const ws = new WebSocket(wsUrl.toString());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Gemini Live connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Gemini Live connect failed: ${err.message}`));
    });
  });
}

/**
 * Gemini Live speech-to-speech provider (experimental; the Live API is
 * a Google preview).
 *
 * @example
 * ```typescript
 * const provider = new GeminiLiveSpeechProvider({
 *   apiKey: process.env.GOOGLE_API_KEY!
 * });
 * ```
 */
export class GeminiLiveSpeechProvider implements RealtimeSpeechProvider {
  readonly name = 'gemini-live-speech';
  private readonly model: string;
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly reconnectBufferBytes: number;
  private readonly reconnectBackoffMs: number[];

  constructor(private readonly options: GeminiLiveSpeechOptions) {
    this.model = options.model ?? 'gemini-3.1-flash-live-preview';
    this.url = options.url ?? DEFAULT_URL;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
    this.reconnectBufferBytes = options.reconnectBufferBytes ?? 64000;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? [250, 1000, 2000];
  }

  async connect(config: RealtimeSpeechConfig): Promise<RealtimeSpeechSession> {
    const ws = await openGeminiSocket(this.url, this.options.apiKey, this.connectTimeoutMs);
    const session = new GeminiLiveSpeechSession(ws, {
      url: this.url,
      apiKey: this.options.apiKey,
      model: this.model,
      // Mutable copy: update() merges stage changes for future reconnects
      config: { ...config },
      connectTimeoutMs: this.connectTimeoutMs,
      reconnectBufferBytes: this.reconnectBufferBytes,
      reconnectBackoffMs: this.reconnectBackoffMs,
      logger: this.options.logger
    });
    ws.send(JSON.stringify({ setup: buildSetup(this.model, config) }));
    try {
      await session.waitUntilReady();
    } catch (error) {
      await session.close().catch(() => {});
      throw error;
    }
    return session;
  }
}
