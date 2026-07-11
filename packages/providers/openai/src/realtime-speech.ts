/**
 * OpenAI Realtime speech-to-speech adapter (RFC 0001, experimental).
 *
 * Bridges a full speech-to-speech Realtime API session (gpt-realtime-2.1
 * family) to the provider-agnostic RealtimeSpeechSession interface:
 * bidirectional 24kHz PCM, normalized transcripts/turn/tool events,
 * client-driven barge-in via response.cancel + item truncation, and a
 * session-expiry warning ahead of OpenAI's 60-minute session cap.
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

export interface OpenAIRealtimeSpeechOptions {
  /** OpenAI API key */
  apiKey: string;
  /** Realtime model (default: 'gpt-realtime-2.1'; '-mini' is the cost-sensitive choice) */
  model?: string;
  /** WebSocket URL base (default: 'wss://api.openai.com/v1/realtime') */
  url?: string;
  /** Connect timeout in ms (default: 10000). No inactivity watchdog: user silence is normal. */
  connectTimeoutMs?: number;
  /** How far ahead of the session's expires_at to emit session-expiring (default: 5 minutes) */
  expiryLeadMs?: number;
}

interface RealtimeServerEvent {
  type?: string;
  event_id?: string;
  delta?: string;
  transcript?: string;
  response_id?: string;
  item_id?: string;
  content_index?: number;
  output_index?: number;
  name?: string;
  call_id?: string;
  arguments?: string;
  session?: { expires_at?: number };
  response?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: { audio_tokens?: number; cached_tokens?: number };
      output_token_details?: { audio_tokens?: number };
    };
  };
  error?: { message?: string; type?: string; code?: string };
}

/** Provider errors that occur in normal barge-in races and must not surface. */
const BENIGN_ERROR_CODES = new Set([
  'response_cancel_not_active',
  'item_truncate_invalid',
  'invalid_item_truncate',
  // response.create colliding with an in-flight response (e.g. two tool
  // results in quick succession) - the active response continues
  'conversation_already_has_active_response'
]);

function mapTools(tools: ToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
}

function mapTurnDetection(td: RealtimeSpeechConfig['turnDetection']): unknown {
  if (!td) return { type: 'server_vad' };
  if (td.type === 'semantic') {
    return { type: 'semantic_vad', ...(td.eagerness && { eagerness: td.eagerness }) };
  }
  return {
    type: 'server_vad',
    ...(td.silenceDurationMs !== undefined && { silence_duration_ms: td.silenceDurationMs }),
    ...(td.thresholdOverride !== undefined && { threshold: td.thresholdOverride })
  };
}

function buildSessionPayload(config: Partial<RealtimeSpeechConfig>, full: boolean): Record<string, unknown> {
  const session: Record<string, unknown> = {};
  if (full) {
    session.type = 'realtime';
    session.output_modalities = ['audio'];
    session.audio = {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        ...(config.inputTranscription !== false && {
          transcription: { model: config.transcriptionModel ?? 'gpt-4o-mini-transcribe' }
        }),
        turn_detection: mapTurnDetection(config.turnDetection)
      },
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
        ...(config.voice && { voice: config.voice })
      }
    };
  } else if (config.voice) {
    session.audio = { output: { voice: config.voice } };
  }
  if (config.instructions !== undefined) session.instructions = config.instructions;
  const tools = mapTools(config.tools);
  if (tools) session.tools = tools;
  if (config.maxOutputTokens !== undefined) session.max_output_tokens = config.maxOutputTokens;
  if (full && config.contextManagement?.strategy === 'truncate') {
    session.truncation = {
      type: 'retention_ratio',
      retention_ratio: config.contextManagement.retentionRatio ?? 0.8
    };
  }
  return session;
}

class OpenAIRealtimeSpeechSession implements RealtimeSpeechSession {
  readonly inputSampleRate = 24000;
  readonly outputSampleRate = 24000;

  private readonly queue = new AsyncEventQueue<RealtimeSpeechEvent>();
  // Barge-in state machine (RFC 0001 §4)
  private activeResponseId: string | null = null;
  private currentAudioItemId: string | null = null;
  private currentContentIndex = 0;
  private itemAudioMsReceived = 0;
  private assistantRunningText = '';
  private userRunningText = '';
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly expiryLeadMs: number
  ) {
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
    ws.on('error', (err: Error) => {
      this.queue.fail(new Error(`OpenAI realtime socket error: ${err.message}`));
    });
    ws.on('close', () => {
      this.clearExpiryTimer();
      if (!this.closed) {
        this.queue.fail(new Error('OpenAI realtime connection closed unexpectedly'));
      } else {
        this.queue.end();
      }
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(data.toString()) as RealtimeServerEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case 'session.created': {
        const expiresAt = event.session?.expires_at;
        if (expiresAt) {
          // expires_at is unix seconds; warn ahead of the 60-minute cap
          const inMs = expiresAt * 1000 - Date.now() - this.expiryLeadMs;
          this.expiryTimer = setTimeout(() => {
            this.queue.push({ type: 'session-expiring', inMs: this.expiryLeadMs, renewable: true });
          }, Math.max(0, inMs));
          this.expiryTimer.unref?.();
        }
        break;
      }
      case 'response.created':
        this.activeResponseId = event.response?.id ?? 'unknown';
        this.currentAudioItemId = null;
        this.itemAudioMsReceived = 0;
        this.assistantRunningText = '';
        this.queue.push({ type: 'response-started', responseId: this.activeResponseId });
        break;
      case 'response.output_audio.delta': {
        const pcm = Buffer.from(event.delta ?? '', 'base64');
        if (event.item_id && event.item_id !== this.currentAudioItemId) {
          this.currentAudioItemId = event.item_id;
          this.currentContentIndex = event.content_index ?? 0;
          this.itemAudioMsReceived = 0;
        }
        // 24kHz mono 16-bit: 48 bytes per ms
        this.itemAudioMsReceived += pcm.length / 48;
        this.queue.push({
          type: 'audio',
          pcm,
          sampleRate: this.outputSampleRate,
          responseId: event.response_id ?? this.activeResponseId ?? 'unknown',
          itemId: event.item_id
        });
        break;
      }
      // Partials carry the accumulated text-so-far, matching pipeline
      // streaming-STT semantics (clients replace, not append)
      case 'response.output_audio_transcript.delta':
        this.assistantRunningText += event.delta ?? '';
        this.queue.push({ type: 'assistant-transcript', text: this.assistantRunningText, isFinal: false });
        break;
      case 'response.output_audio_transcript.done':
        this.assistantRunningText = '';
        this.queue.push({ type: 'assistant-transcript', text: event.transcript ?? '', isFinal: true });
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this.userRunningText += event.delta ?? '';
        this.queue.push({ type: 'user-transcript', text: this.userRunningText, isFinal: false });
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.userRunningText = '';
        this.queue.push({ type: 'user-transcript', text: event.transcript ?? '', isFinal: true });
        break;
      case 'input_audio_buffer.speech_started':
        this.queue.push({ type: 'user-speech-started' });
        break;
      case 'input_audio_buffer.speech_stopped':
        this.queue.push({ type: 'user-speech-stopped' });
        break;
      case 'response.function_call_arguments.done': {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(event.arguments ?? '{}') as Record<string, unknown>;
        } catch {
          // leave args empty; the executor surfaces the problem
        }
        this.queue.push({
          type: 'tool-call',
          callId: event.call_id ?? '',
          name: event.name ?? '',
          arguments: args
        });
        break;
      }
      case 'response.done': {
        const responseId = event.response?.id ?? this.activeResponseId ?? 'unknown';
        if (this.activeResponseId === responseId || event.response?.id === undefined) {
          this.activeResponseId = null;
        }
        this.queue.push({
          type: 'response-done',
          responseId,
          usage: mapUsage(event.response?.usage)
        });
        break;
      }
      case 'error': {
        const code = event.error?.code ?? '';
        const message = event.error?.message ?? '';
        // Normal barge-in races (e.g. cancel landed after response.done,
        // truncate raced an item completing) must not kill the session;
        // match by code and, as a fallback, by message content
        if (BENIGN_ERROR_CODES.has(code) || /\b(cancel|truncat)/i.test(message)) {
          return;
        }
        this.queue.push({
          type: 'error',
          error: new Error(`OpenAI realtime error: ${event.error?.message ?? code}`),
          recoverable: false
        });
        break;
      }
      default:
        break;
    }
  }

  events(): AsyncIterable<RealtimeSpeechEvent> {
    return this.queue;
  }

  sendAudio(frame: Buffer): void {
    if (this.ws.readyState !== WebSocket.OPEN || frame.length === 0) return;
    this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') }));
  }

  cancelResponse(playedMs?: number): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    // Safe no-op when nothing is active (RFC 0001 §4)
    if (!this.activeResponseId) return;
    this.ws.send(JSON.stringify({ type: 'response.cancel' }));
    // M2 TODO: currentAudioItemId is the latest item RECEIVED, which can
    // lead the item currently PLAYING in multi-item responses (tools);
    // cancelResponse should take the playing itemId once M2 lands
    if (playedMs !== undefined && this.currentAudioItemId) {
      this.ws.send(
        JSON.stringify({
          type: 'conversation.item.truncate',
          item_id: this.currentAudioItemId,
          content_index: this.currentContentIndex,
          // Clamp to audio actually received - the API rejects overshoot
          audio_end_ms: Math.min(Math.floor(playedMs), Math.floor(this.itemAudioMsReceived))
        })
      );
    }
    this.activeResponseId = null;
  }

  sendToolResult(callId: string, output: unknown): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: typeof output === 'string' ? output : JSON.stringify(output)
        }
      })
    );
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  requestResponse(): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'response.create' }));
  }

  async update(config: Partial<RealtimeSpeechConfig>): Promise<void> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('OpenAI realtime session is not open');
    }
    this.ws.send(JSON.stringify({ type: 'session.update', session: buildSessionPayload(config, false) }));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearExpiryTimer();
    this.queue.end();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
}

type RealtimeUsageWire = NonNullable<RealtimeServerEvent['response']>['usage'];

function mapUsage(usage: RealtimeUsageWire | undefined): RealtimeUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    audioInputTokens: usage.input_token_details?.audio_tokens,
    audioOutputTokens: usage.output_token_details?.audio_tokens,
    cachedTokens: usage.input_token_details?.cached_tokens
  };
}

/**
 * OpenAI Realtime speech-to-speech provider (experimental).
 *
 * @example
 * ```typescript
 * const provider = new OpenAIRealtimeSpeechProvider({
 *   apiKey: process.env.OPENAI_API_KEY!
 * });
 * ```
 */
export class OpenAIRealtimeSpeechProvider implements RealtimeSpeechProvider {
  readonly name = 'openai-realtime-speech';
  private readonly model: string;
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly expiryLeadMs: number;

  constructor(private readonly options: OpenAIRealtimeSpeechOptions) {
    this.model = options.model ?? 'gpt-realtime-2.1';
    this.url = options.url ?? 'wss://api.openai.com/v1/realtime';
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10000;
    this.expiryLeadMs = options.expiryLeadMs ?? 300000;
  }

  async connect(config: RealtimeSpeechConfig): Promise<RealtimeSpeechSession> {
    const wsUrl = new URL(this.url);
    if (!wsUrl.searchParams.has('model')) {
      wsUrl.searchParams.set('model', this.model);
    }
    const ws = new WebSocket(wsUrl.toString(), {
      headers: { Authorization: `Bearer ${this.options.apiKey}` }
    });

    // Construct the session (attaching message listeners) BEFORE awaiting
    // open: on fast links the server's session.created can arrive in the
    // same packet as the handshake and would otherwise be lost
    const session = new OpenAIRealtimeSpeechSession(ws, this.expiryLeadMs);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Kill the in-flight socket: a late open would otherwise create
        // a live, billable session with no owner
        ws.terminate();
        reject(new Error(`OpenAI realtime connect timed out after ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      timer.unref?.();
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (err: Error) => {
        clearTimeout(timer);
        reject(new Error(`OpenAI realtime connect failed: ${err.message}`));
      });
    });

    ws.send(JSON.stringify({ type: 'session.update', session: buildSessionPayload(config, true) }));
    return session;
  }
}
