/**
 * LLMRTCServer - Main server class for the LLMRTC backend
 * Supports both CLI and library usage
 */

import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import {
  ConversationOrchestrator,
  VisionAttachment,
  ConversationProviders,
  PROTOCOL_VERSION,
  createReadyMessage,
  createErrorMessage,
  type ErrorCode,
  type OrchestratorHooks,
  type ServerHooks,
  type MetricsAdapter,
  type ErrorContext,
  MetricNames,
  NoopMetrics,
  createTimingInfo,
  createErrorContext,
  callHookSafe,
  type Playbook,
  ToolRegistry,
  type PlaybookOrchestratorOptions
} from '@metered/llmrtc-core';
import type {
  TurnOrchestrator,
  TurnOrchestratorYield,
  ToolCallStartEvent,
  ToolCallEndEvent,
  StageChangeEvent
} from './turn-orchestrator.js';
import { VoicePlaybookOrchestrator } from './voice-playbook-orchestrator.js';
import { AudioProcessor } from './audio-processor.js';
import {
  decodeToPCM,
  feedAudioToSource,
  feedPCMChunkToSource,
  flushPCMFeeder,
  createPCMFeederState,
  PCMFeederState
} from './mp3-decoder.js';
import { NativePeerServer, AudioData } from './native-peer-server.js';
import { SessionManager } from './session-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface LLMRTCServerConfig {
  /** Providers - users must provide pre-built provider instances */
  providers: ConversationProviders;

  /** Server port (default: 8787) */
  port?: number;

  /** Server host (default: '127.0.0.1') */
  host?: string;

  /** System prompt for the AI assistant */
  systemPrompt?: string;

  /** Number of messages to keep in history (default: 8) */
  historyLimit?: number;

  /** Enable streaming TTS for lower latency (default: true) */
  streamingTTS?: boolean;

  /** Heartbeat timeout in ms (default: 45000) */
  heartbeatTimeout?: number;

  /** CORS options */
  cors?: cors.CorsOptions;

  /**
   * Hooks for server-level events (connection, disconnect, speech, errors)
   * These hooks also include orchestrator hooks which are passed to each session.
   */
  hooks?: ServerHooks & OrchestratorHooks;

  /**
   * Metrics adapter for emitting timing and counter metrics
   * Use ConsoleMetrics for debugging or implement MetricsAdapter for Prometheus, etc.
   */
  metrics?: MetricsAdapter;

  /**
   * Custom sentence boundary splitter for streaming TTS
   * Use this to customize how text is split into sentences for TTS streaming.
   */
  sentenceChunker?: (text: string) => string[];

  // ==========================================================================
  // Playbook Mode (optional)
  // ==========================================================================

  /**
   * Playbook definition for multi-stage conversations with tool calling.
   * When provided, enables VoicePlaybookOrchestrator instead of ConversationOrchestrator.
   */
  playbook?: Playbook;

  /**
   * Tool registry with registered tools.
   * Required when playbook is provided.
   */
  toolRegistry?: ToolRegistry;

  /**
   * Options for playbook orchestrator
   */
  playbookOptions?: {
    /** Maximum tool calls per turn (default: 10) */
    maxToolCallsPerTurn?: number;
    /** Phase 1 timeout in ms (default: 60000) */
    phase1TimeoutMs?: number;
    /** Enable debug logging */
    debug?: boolean;
  };
}

export interface LLMRTCServerEvents {
  listening: (info: { host: string; port: number }) => void;
  connection: (info: { id: string }) => void;
  disconnect: (info: { id: string }) => void;
  error: (error: Error) => void;
}

// =============================================================================
// LLMRTCServer Class
// =============================================================================

export class LLMRTCServer {
  private readonly config: Required<
    Omit<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions'>
  > &
    Pick<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions'>;
  private readonly providers: ConversationProviders;
  private readonly sessionManager: SessionManager;
  private readonly hooks: ServerHooks & OrchestratorHooks;
  private readonly metrics: MetricsAdapter;

  private app: express.Express | null = null;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private wrtcLib: any = null;
  private RTCAudioSource: any = null;

  private eventHandlers: Partial<LLMRTCServerEvents> = {};

  constructor(config: LLMRTCServerConfig) {
    this.config = {
      port: 8787,
      host: '127.0.0.1',
      systemPrompt: 'You are a helpful realtime voice assistant.',
      historyLimit: 8,
      streamingTTS: true,
      heartbeatTimeout: 45000,
      ...config
    };

    this.providers = config.providers;
    this.sessionManager = new SessionManager();
    this.hooks = config.hooks ?? {};
    this.metrics = config.metrics ?? new NoopMetrics();
  }

  /**
   * Register event handlers
   */
  on<K extends keyof LLMRTCServerEvents>(event: K, handler: LLMRTCServerEvents[K]): this {
    this.eventHandlers[event] = handler;
    return this;
  }

  private emit<K extends keyof LLMRTCServerEvents>(
    event: K,
    ...args: Parameters<LLMRTCServerEvents[K]>
  ): void {
    const handler = this.eventHandlers[event];
    if (handler) {
      (handler as (...args: unknown[]) => void)(...args);
    }
  }

  /**
   * Initialize providers and start the server
   */
  async start(): Promise<void> {
    // Initialize providers
    await Promise.all([
      this.providers.llm.init?.(),
      this.providers.stt.init?.(),
      this.providers.tts.init?.(),
      this.providers.vision?.init?.()
    ]);

    // Load WebRTC library
    await this.loadWebRTC();

    // Create Express app
    this.app = express();
    this.app.use(cors(this.config.cors));
    this.app.get('/health', (_req, res) => res.json({ ok: true }));

    // Create HTTP server
    this.server = http.createServer(this.app);

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    this.setupWebSocketServer();

    // Start listening
    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(
          `@metered/LLMRTC server listening on ${this.config.host}:${this.config.port}`
        );
        this.logProviderConfig();
        this.emit('listening', { host: this.config.host, port: this.config.port });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        this.wss.clients.forEach((client) => client.close());
        this.wss.close();
      }
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express app for adding custom routes/middleware
   */
  getApp(): express.Express | null {
    return this.app;
  }

  /**
   * Get the HTTP server
   */
  getServer(): http.Server | null {
    return this.server;
  }

  /**
   * Get the providers
   */
  getProviders(): ConversationProviders {
    return this.providers;
  }

  private async loadWebRTC(): Promise<void> {
    try {
      const mod = await import('@roamhq/wrtc');
      this.wrtcLib = (mod as any).default ?? mod;
      this.RTCAudioSource = this.wrtcLib.nonstandard?.RTCAudioSource;
      console.log('[server] WebRTC loaded (@roamhq/wrtc)');
      console.log('[server] RTCAudioSource available:', !!this.RTCAudioSource);
    } catch {
      console.warn('[server] WebRTC not available, WebRTC connections will fail');
    }
  }

  private logProviderConfig(): void {
    console.log('='.repeat(60));
    console.log('[server] Provider Configuration:');
    console.log(`  LLM: ${this.providers.llm.name}`);
    console.log(`  STT: ${this.providers.stt.name}`);
    console.log(`  TTS: ${this.providers.tts.name}`);
    console.log(`  Vision: ${this.providers.vision?.name ?? 'disabled'}`);
    console.log(`  Streaming TTS: ${this.config.streamingTTS ? 'enabled' : 'disabled'}`);
    console.log(`  Playbook Mode: ${this.config.playbook ? 'enabled' : 'disabled'}`);
    console.log('='.repeat(60));
  }

  /**
   * Create the appropriate orchestrator based on config
   */
  private createOrchestrator(
    sessionId: string,
    orchestratorHooks: OrchestratorHooks
  ): TurnOrchestrator {
    // Playbook mode: use VoicePlaybookOrchestrator
    if (this.config.playbook && this.config.toolRegistry) {
      console.log(`[server] Creating VoicePlaybookOrchestrator for session ${sessionId}`);
      return new VoicePlaybookOrchestrator({
        providers: this.providers,
        playbook: this.config.playbook,
        toolRegistry: this.config.toolRegistry,
        systemPrompt: this.config.systemPrompt,
        streamingTTS: this.config.streamingTTS,
        hooks: orchestratorHooks,
        metrics: this.metrics,
        sessionId,
        sentenceChunker: this.config.sentenceChunker,
        playbookOptions: this.config.playbookOptions
      });
    }

    // Simple mode: use ConversationOrchestrator
    return new ConversationOrchestrator({
      systemPrompt: this.config.systemPrompt,
      historyLimit: this.config.historyLimit,
      providers: this.providers,
      streamingTTS: this.config.streamingTTS,
      sessionId,
      hooks: orchestratorHooks,
      metrics: this.metrics,
      sentenceChunker: this.config.sentenceChunker
    });
  }

  private setupWebSocketServer(): void {
    if (!this.wss) return;

    this.wss.on('connection', async (ws) => {
      const connId = uuidv4();
      const connectionStartTime = Date.now();
      console.log(`[server] New connection: ${connId}`);

      // Update active connections gauge
      this.metrics.gauge(MetricNames.CONNECTIONS, this.wss!.clients.size);

      // Call onConnection hook
      await callHookSafe(this.hooks.onConnection, connId, connId);
      this.emit('connection', { id: connId });

      // Extract orchestrator hooks from combined hooks
      const orchestratorHooks: OrchestratorHooks = {
        onTurnStart: this.hooks.onTurnStart,
        onTurnEnd: this.hooks.onTurnEnd,
        onSTTStart: this.hooks.onSTTStart,
        onSTTEnd: this.hooks.onSTTEnd,
        onSTTError: this.hooks.onSTTError,
        onLLMStart: this.hooks.onLLMStart,
        onLLMChunk: this.hooks.onLLMChunk,
        onLLMEnd: this.hooks.onLLMEnd,
        onLLMError: this.hooks.onLLMError,
        onTTSStart: this.hooks.onTTSStart,
        onTTSChunk: this.hooks.onTTSChunk,
        onTTSEnd: this.hooks.onTTSEnd,
        onTTSError: this.hooks.onTTSError
      };

      // Create session with appropriate orchestrator (ConversationOrchestrator or VoicePlaybookOrchestrator)
      let session = this.sessionManager.createSession(
        connId,
        this.createOrchestrator(connId, orchestratorHooks)
      );

      let peer: NativePeerServer | null = null;
      let audioProcessor: AudioProcessor | null = null;
      let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingAttachments: VisionAttachment[] = [];

      // TTS playback state
      let currentAbortController: AbortController | null = null;
      let isTTSPlaying = false;

      const cancelCurrentTTS = () => {
        if (currentAbortController) {
          console.log('[server] Cancelling current TTS playback');
          currentAbortController.abort();
          currentAbortController = null;
        }
        isTTSPlaying = false;
      };

      ws.send(JSON.stringify(createReadyMessage(connId)));

      const resetHeartbeatTimeout = () => {
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
          console.log(`[server] Client ${connId} heartbeat timeout`);
          ws.close();
        }, this.config.heartbeatTimeout);
      };

      resetHeartbeatTimeout();

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());

          switch (msg.type) {
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
              resetHeartbeatTimeout();
              this.sessionManager.touchSession(session.id);
              break;

            case 'reconnect': {
              const existingSession = this.sessionManager.getSession(msg.sessionId);
              if (existingSession) {
                session = existingSession;
                console.log(`[server] Session recovered: ${msg.sessionId}`);
                ws.send(
                  JSON.stringify({
                    type: 'reconnect-ack',
                    success: true,
                    sessionId: msg.sessionId,
                    historyRecovered: true
                  })
                );
              } else {
                const newSessionId = msg.sessionId || connId;
                session = this.sessionManager.createSession(
                  newSessionId,
                  this.createOrchestrator(newSessionId, orchestratorHooks)
                );
                ws.send(
                  JSON.stringify({
                    type: 'reconnect-ack',
                    success: true,
                    sessionId: session.id,
                    historyRecovered: false
                  })
                );
              }
              break;
            }

            case 'offer':
            case 'signal':
              console.log('[server] Received', msg.type);

              if (!peer || peer.destroyed) {
                peer = this.createPeer(ws);
                if (peer) {
                  audioProcessor = new AudioProcessor();
                  this.setupPeerHandlers(
                    peer,
                    audioProcessor,
                    ws,
                    session.orchestrator,
                    connId,
                    () => pendingAttachments,
                    (atts) => {
                      pendingAttachments = atts;
                    },
                    () => isTTSPlaying,
                    (playing) => {
                      isTTSPlaying = playing;
                    },
                    cancelCurrentTTS,
                    () => currentAbortController,
                    (ctrl) => {
                      currentAbortController = ctrl;
                    }
                  );
                }
              }

              if (peer && msg.signal) {
                const answer = await peer.handleOffer(msg.signal);
                ws.send(JSON.stringify({ type: 'signal', signal: answer }));
              }
              break;

            case 'audio':
              console.log('[server] Received audio message, size:', msg.data?.length, 'bytes');
              const audioBuf = Buffer.from(msg.data, 'base64');
              const attachments: VisionAttachment[] = msg.attachments ?? [];
              await this.handleAudio(
                session.orchestrator,
                audioBuf,
                ws,
                peer,
                attachments,
                peer?.ttsAudioSource
              );
              break;
          }
        } catch (err) {
          console.error('[server] Message error:', err);
        }
      });

      ws.on('close', async () => {
        console.log(`[server] Connection closed: ${connId}`);
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        cancelCurrentTTS();
        peer?.destroy();
        audioProcessor?.destroy();

        // Update active connections gauge
        this.metrics.gauge(MetricNames.CONNECTIONS, this.wss!.clients.size);

        // Call onDisconnect hook with session timing
        const sessionTiming = createTimingInfo(connectionStartTime, Date.now());
        this.metrics.timing(MetricNames.SESSION_DURATION, sessionTiming.durationMs);
        await callHookSafe(this.hooks.onDisconnect, connId, sessionTiming);

        this.emit('disconnect', { id: connId });
      });

      ws.on('error', async (err) => {
        console.error(`[server] WebSocket error for ${connId}:`, err);

        // Call onError hook
        const errorContext = createErrorContext('INTERNAL_ERROR', 'server', {
          sessionId: connId
        });
        this.metrics.increment(MetricNames.ERRORS, 1, { component: 'server' });
        await callHookSafe(this.hooks.onError, err, errorContext);

        this.emit('error', err);
      });
    });
  }

  private createPeer(ws: WebSocket): NativePeerServer | null {
    if (!this.wrtcLib) {
      ws.send(JSON.stringify(createErrorMessage('WEBRTC_UNAVAILABLE', 'WebRTC not available on server')));
      return null;
    }

    console.log(
      '[server] Creating NativePeerServer with wrtcLib.nonstandard:',
      this.wrtcLib.nonstandard ? 'exists' : 'undefined'
    );

    const peer = new NativePeerServer({
      wrtcLib: this.wrtcLib,
      iceServers: []
    });

    console.log('[server] Created NativePeerServer');
    return peer;
  }

  private setupPeerHandlers(
    peer: NativePeerServer,
    audioProcessor: AudioProcessor,
    ws: WebSocket,
    orchestrator: TurnOrchestrator,
    sessionId: string,
    getPendingAttachments: () => VisionAttachment[],
    setPendingAttachments: (atts: VisionAttachment[]) => void,
    getIsTTSPlaying: () => boolean,
    setIsTTSPlaying: (playing: boolean) => void,
    cancelCurrentTTS: () => void,
    getAbortController: () => AbortController | null,
    setAbortController: (ctrl: AbortController | null) => void
  ): void {
    peer.on('connect', () => {
      console.log('[server] WebRTC peer connected');
    });

    peer.on('close', () => {
      console.log('[server] WebRTC peer closed');
      audioProcessor.destroy();
    });

    peer.on('error', (err) => {
      console.error('[server] Peer error:', err);
      audioProcessor.destroy();
    });

    peer.on('track', async (track: MediaStreamTrack) => {
      console.log('[server] Received track:', track.kind);

      if (track.kind === 'audio') {
        try {
          await audioProcessor.initVAD();
        } catch (err) {
          console.error('[server] Failed to initialize VAD:', err);
        }

        let speechStartTime = 0;

        audioProcessor.on('speechStart', async () => {
          console.log('[server] VAD detected speech start');
          speechStartTime = Date.now();

          // Call onSpeechStart hook
          await callHookSafe(this.hooks.onSpeechStart, sessionId, speechStartTime);

          if (getIsTTSPlaying()) {
            console.log('[server] User interrupted TTS - cancelling playback');
            cancelCurrentTTS();
            this.sendBoth({ type: 'tts-cancelled' }, ws, peer);
          }
          this.sendBoth({ type: 'speech-start' }, ws, peer);
        });

        audioProcessor.on('speechEnd', async (pcmBuffer: Buffer) => {
          const speechEndTime = Date.now();
          const audioDurationMs = speechEndTime - speechStartTime;
          console.log('[server] VAD detected speech end, processing', pcmBuffer.length, 'bytes');

          // Call onSpeechEnd hook
          await callHookSafe(this.hooks.onSpeechEnd, sessionId, speechEndTime, audioDurationMs);

          this.sendBoth({ type: 'speech-end' }, ws, peer);

          if (pcmBuffer.length > 0) {
            cancelCurrentTTS();

            const abortController = new AbortController();
            setAbortController(abortController);
            const signal = abortController.signal;

            const wavBuffer = audioProcessor.pcmToWav(pcmBuffer);
            console.log('[server] PCM to WAV conversion complete:', wavBuffer.length, 'bytes');

            await this.handleAudio(
              orchestrator,
              wavBuffer,
              ws,
              peer,
              getPendingAttachments(),
              peer.ttsAudioSource,
              {
                signal,
                onTTSStart: () => setIsTTSPlaying(true),
                onTTSEnd: () => {
                  setIsTTSPlaying(false);
                  setAbortController(null);
                }
              }
            );
            setPendingAttachments([]);
          }
        });
      }
    });

    peer.on('audioData', async (data: AudioData) => {
      await audioProcessor.processPCMData(data);
    });

    peer.on('data', async (data: string) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.type) {
          case 'attachments':
            setPendingAttachments(msg.attachments ?? []);
            console.log('[server] Received attachments:', getPendingAttachments().length);
            break;

          default:
            console.log('[server] Unknown data channel message:', msg.type);
        }
      } catch (err) {
        console.error('[server] Peer data error:', err);
      }
    });
  }

  private async handleAudio(
    orchestrator: TurnOrchestrator,
    audio: Buffer,
    ws: WebSocket,
    peer: NativePeerServer | null,
    attachments: VisionAttachment[],
    ttsAudioSource?: any,
    options?: {
      signal?: AbortSignal;
      onTTSStart?: () => void;
      onTTSEnd?: () => void;
    }
  ): Promise<void> {
    const { signal, onTTSStart, onTTSEnd } = options ?? {};

    console.log('[server] handleAudio - processing', audio.length, 'bytes');

    let pcmFeederState: PCMFeederState | null = null;
    let ttsStarted = false;

    try {
      for await (const item of orchestrator.runTurnStream(audio, attachments, { signal })) {
        if (signal?.aborted) {
          console.log('[server] Response generation cancelled by user interruption');
          if (pcmFeederState) {
            pcmFeederState.aborted = true;
          }
          break;
        }

        console.log('[server] orchestrator yielded:', Object.keys(item));

        if ('isFinal' in item) {
          this.sendBoth({ type: 'transcript', text: item.text, isFinal: item.isFinal }, ws, peer);
        } else if ('done' in item && 'content' in item) {
          this.sendBoth({ type: 'llm-chunk', content: item.content, done: item.done }, ws, peer);
        } else if ('fullText' in item) {
          this.sendBoth({ type: 'llm', text: item.fullText }, ws, peer);
        } else if ('type' in item) {
          switch (item.type) {
            case 'tts-start':
              if (!ttsStarted) {
                ttsStarted = true;
                onTTSStart?.();
                this.sendBoth({ type: 'tts-start' }, ws, peer);
                if (ttsAudioSource && this.RTCAudioSource) {
                  pcmFeederState = createPCMFeederState();
                }
              }
              break;

            case 'tts-chunk':
              console.log(
                `[server] TTS chunk: ${item.audio.length} bytes, format=${item.format}, sampleRate=${item.sampleRate}`
              );
              if (ttsAudioSource && this.RTCAudioSource && pcmFeederState) {
                await feedPCMChunkToSource(item.audio, ttsAudioSource, pcmFeederState, {
                  inputSampleRate: item.sampleRate ?? 24000,
                  signal
                });
              } else {
                this.sendBoth(
                  {
                    type: 'tts-chunk',
                    format: item.format,
                    sampleRate: item.sampleRate,
                    data: item.audio.toString('base64')
                  },
                  ws,
                  peer
                );
              }
              break;

            case 'tts-complete':
              if (ttsAudioSource && pcmFeederState) {
                await flushPCMFeeder(ttsAudioSource, pcmFeederState);
              }
              this.sendBoth({ type: 'tts-complete' }, ws, peer);
              onTTSEnd?.();
              ttsStarted = false;
              pcmFeederState = null;
              break;

            // Playbook mode: Tool call events
            case 'tool-call-start':
              console.log(`[server] Tool call started: ${(item as ToolCallStartEvent).name}`);
              this.sendBoth({
                type: 'tool-call-start',
                name: (item as ToolCallStartEvent).name,
                callId: (item as ToolCallStartEvent).callId,
                arguments: (item as ToolCallStartEvent).arguments
              }, ws, peer);
              break;

            case 'tool-call-end':
              console.log(`[server] Tool call completed: ${(item as ToolCallEndEvent).callId}`);
              this.sendBoth({
                type: 'tool-call-end',
                callId: (item as ToolCallEndEvent).callId,
                result: (item as ToolCallEndEvent).result,
                error: (item as ToolCallEndEvent).error,
                durationMs: (item as ToolCallEndEvent).durationMs
              }, ws, peer);
              break;

            // Playbook mode: Stage transition events
            case 'stage-change':
              console.log(`[server] Stage changed: ${(item as StageChangeEvent).from} → ${(item as StageChangeEvent).to}`);
              this.sendBoth({
                type: 'stage-change',
                from: (item as StageChangeEvent).from,
                to: (item as StageChangeEvent).to,
                reason: (item as StageChangeEvent).reason
              }, ws, peer);
              break;
          }
        } else if ('audio' in item) {
          if (ttsAudioSource && this.RTCAudioSource) {
            console.log('[server] Decoding TTS audio for WebRTC playback, format:', item.format);
            try {
              const pcmBuffer = await decodeToPCM(item.audio, item.format);
              console.log('[server] Decoded to PCM:', pcmBuffer.length, 'bytes');

              if (!ttsStarted) {
                onTTSStart?.();
                this.sendBoth({ type: 'tts-start' }, ws, peer);
                ttsStarted = true;
              }

              const completed = await feedAudioToSource(pcmBuffer, ttsAudioSource, {
                signal,
                onComplete: () => {
                  this.sendBoth({ type: 'tts-complete' }, ws, peer);
                }
              });

              if (!completed) {
                console.log('[server] TTS playback was interrupted');
                this.sendBoth({ type: 'tts-cancelled' }, ws, peer);
              }

              onTTSEnd?.();
              ttsStarted = false;
            } catch (decodeErr) {
              console.error('[server] Failed to decode TTS audio:', decodeErr);
              this.sendBoth(
                {
                  type: 'tts',
                  format: item.format,
                  data: item.audio.toString('base64')
                },
                ws,
                peer
              );
            }
          } else {
            this.sendBoth(
              {
                type: 'tts',
                format: item.format,
                data: item.audio.toString('base64')
              },
              ws,
              peer
            );
          }
        }
      }
    } catch (err) {
      console.error('[server] handleAudio error:', err);
      this.sendBoth(createErrorMessage('AUDIO_PROCESSING_ERROR', (err as Error).message), ws, peer);
    }
  }

  private sendBoth(payload: unknown, ws: WebSocket, peer: NativePeerServer | null): void {
    const data = JSON.stringify(payload);
    if (ws.readyState === ws.OPEN) ws.send(data);
    if (peer?.connected) peer.send(data);
  }
}
