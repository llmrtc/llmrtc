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
  createReadyMessage,
  createErrorMessage,
  type OrchestratorHooks,
  type ServerHooks,
  type MetricsAdapter,
  MetricNames,
  NoopMetrics,
  createTimingInfo,
  createErrorContext,
  callHookSafe,
  type Playbook,
  ToolRegistry
} from '@llmrtc/llmrtc-core';
import type {
  TurnOrchestrator,
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
import type { WrtcAudioSource, WrtcModule } from './wrtc-types.js';
import { SessionManager } from './session-manager.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default ICE servers - Metered STUN server
 * Used when no custom ICE servers or Metered TURN is configured
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.metered.ca:80' }
];

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

  // ==========================================================================
  // ICE Server Configuration
  // ==========================================================================

  /**
   * Custom ICE servers for WebRTC (STUN/TURN).
   * If provided, overrides Metered TURN configuration.
   */
  iceServers?: RTCIceServer[];

  /**
   * Metered TURN server configuration (recommended).
   * Fetches ICE servers from Metered API at connection time.
   * @see https://www.metered.ca/tools/openrelay/
   */
  metered?: {
    /** App name from Metered dashboard (e.g., 'myapp' for myapp.metered.live) */
    appName: string;
    /** API key for fetching TURN credentials */
    apiKey: string;
    /** Optional region preference (e.g., 'us_east', 'europe', 'asia') */
    region?: string;
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
    Omit<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions' | 'iceServers' | 'metered'>
  > &
    Pick<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions' | 'iceServers' | 'metered'>;
  private readonly providers: ConversationProviders;
  private readonly sessionManager: SessionManager;
  private readonly hooks: ServerHooks & OrchestratorHooks;
  private readonly metrics: MetricsAdapter;

  private app: express.Express | null = null;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private wrtcLib: WrtcModule | null = null;
  private RTCAudioSource: (new () => WrtcAudioSource) | null = null;

  /** Cached ICE servers with expiry (Metered TURN credentials are time-limited) */
  private cachedIceServers: { servers: RTCIceServer[]; expiresAt: number } | null = null;

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

  // ===========================================================================
  // ICE Server Resolution
  // ===========================================================================

  /**
   * Fetch ICE servers from Metered TURN API
   * @returns Array of RTCIceServer objects from Metered
   */
  private async fetchMeteredIceServers(): Promise<RTCIceServer[] | null> {
    const { appName, apiKey, region } = this.config.metered!;
    const regionParam = region ? `&region=${region}` : '';
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}${regionParam}`;

    try {
      // A hung credentials fetch must not stall connection setup forever
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        throw new Error(`Metered API error: ${response.status} ${response.statusText}`);
      }
      const iceServers = (await response.json()) as RTCIceServer[];
      console.log(`[server] Fetched ${iceServers.length} ICE servers from Metered`);
      return iceServers;
    } catch (error) {
      console.warn('[server] Failed to fetch Metered TURN credentials:', error);
      console.warn('[server] Falling back to STUN-only mode');
      return null;
    }
  }

  /** How long fetched TURN credentials are served before refetching */
  private static readonly ICE_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * Resolve ICE servers based on configuration
   * Priority: custom iceServers > metered > default STUN
   * Metered credentials are time-limited, so they are cached with a TTL and
   * refetched; fetch failures are never cached.
   */
  private async resolveIceServers(): Promise<RTCIceServer[]> {
    // Priority 1: Custom ICE servers from config
    if (this.config.iceServers?.length) {
      return this.config.iceServers;
    }

    // Priority 2: Fetch from Metered TURN API (TTL cache)
    if (this.config.metered) {
      if (this.cachedIceServers && Date.now() < this.cachedIceServers.expiresAt) {
        return this.cachedIceServers.servers;
      }
      const fetched = await this.fetchMeteredIceServers();
      if (fetched) {
        this.cachedIceServers = {
          servers: fetched,
          expiresAt: Date.now() + LLMRTCServer.ICE_CACHE_TTL_MS
        };
        return fetched;
      }
      // Transient failure: serve stale credentials if we have them,
      // otherwise fall back to STUN-only for this connection
      return this.cachedIceServers?.servers ?? DEFAULT_ICE_SERVERS;
    }

    // Priority 3: Default STUN server
    return DEFAULT_ICE_SERVERS;
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
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        reject(err);
      };
      this.server!.once('error', onError);
      this.server!.listen(this.config.port, this.config.host, () => {
        this.server!.off('error', onError);
        // Surface later runtime errors through the event handler instead
        this.server!.on('error', (err) => this.emit('error', err));
        console.log(
          `@llmrtc/LLMRTC server listening on ${this.config.host}:${this.config.port}`
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
    // Stop the session sweeper so the event loop can drain
    this.sessionManager.destroy();

    await new Promise<void>((resolve, reject) => {
      if (this.wss) {
        this.wss.clients.forEach((client) => client.close(1001, 'server shutting down'));
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

    this.wss = null;
    this.server = null;
    this.app = null;
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
      const mod = (await import('@roamhq/wrtc')) as unknown as WrtcModule & {
        default?: WrtcModule;
      };
      this.wrtcLib = mod.default ?? mod;
      this.RTCAudioSource = this.wrtcLib.nonstandard?.RTCAudioSource ?? null;
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

    // The ws server re-emits underlying http server errors; without a
    // listener an EADDRINUSE would crash the process instead of surfacing
    // through start()/the error handler
    this.wss.on('error', (err) => this.emit('error', err));

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

      // Turn state
      let currentAbortController: AbortController | null = null;
      let isTTSPlaying = false;
      // Serializes turns for this connection: a new utterance queues behind
      // the (aborted) previous one instead of running concurrently with it
      let turnChain: Promise<void> = Promise.resolve();

      const enqueueTurn = (run: () => Promise<void>): Promise<void> => {
        turnChain = turnChain.then(run).catch((err) => {
          console.error('[server] Turn error:', err);
        });
        return turnChain;
      };

      const cancelCurrentTurn = () => {
        if (currentAbortController) {
          console.log('[server] Cancelling in-flight turn');
          currentAbortController.abort();
          currentAbortController = null;
        }
        isTTSPlaying = false;
      };

      /** Start a serialized, abortable turn from an audio buffer. */
      const startTurn = (audioBuf: Buffer, attachments: VisionAttachment[]): Promise<void> => {
        cancelCurrentTurn();
        const abortController = new AbortController();
        currentAbortController = abortController;

        return enqueueTurn(() =>
          this.handleAudio(
            session.orchestrator,
            audioBuf,
            ws,
            peer,
            attachments,
            peer?.ttsAudioSource,
            {
              signal: abortController.signal,
              onTTSStart: () => {
                if (currentAbortController === abortController) {
                  isTTSPlaying = true;
                }
              },
              onTTSEnd: () => {
                // A cancelled turn may finish late; only clear the state it
                // still owns, never the next turn's controller
                if (currentAbortController === abortController) {
                  isTTSPlaying = false;
                  currentAbortController = null;
                }
              }
            }
          )
        );
      };

      const resetHeartbeatTimeout = () => {
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
          console.log(`[server] Client ${connId} heartbeat timeout`);
          ws.close();
        }, this.config.heartbeatTimeout);
      };

      resetHeartbeatTimeout();

      // Register the message handler before any await so early client
      // messages are not silently dropped while ICE servers resolve
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
                // Drop the fresh session auto-created for this connection
                if (session.id !== existingSession.id) {
                  this.sessionManager.removeSession(session.id);
                }
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
                // Unknown or expired session: keep the current one rather
                // than minting sessions keyed by client-supplied ids
                console.log(`[server] Session not found for reconnect: ${msg.sessionId}`);
                ws.send(
                  JSON.stringify({
                    type: 'reconnect-ack',
                    success: false,
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
                peer = this.createPeer(ws, await this.resolveIceServers());
                if (peer) {
                  audioProcessor = new AudioProcessor();
                  this.setupPeerHandlers(
                    peer,
                    audioProcessor,
                    ws,
                    connId,
                    () => pendingAttachments,
                    (atts) => {
                      pendingAttachments = atts;
                    },
                    () => isTTSPlaying,
                    cancelCurrentTurn,
                    () => currentAbortController,
                    startTurn,
                    () => {
                      // Peer closed underneath us: reap it so a client
                      // re-offer creates a fresh peer instead of silently
                      // failing against a closed connection
                      peer?.destroy();
                      peer = null;
                      audioProcessor = null;
                    }
                  );
                }
              }

              if (peer && msg.signal) {
                const answer = await peer.handleOffer(msg.signal);
                ws.send(JSON.stringify({ type: 'signal', signal: answer }));
              }
              break;

            case 'audio': {
              console.log('[server] Received audio message, size:', msg.data?.length, 'bytes');
              const audioBuf = Buffer.from(msg.data, 'base64');
              const attachments: VisionAttachment[] = msg.attachments ?? [];
              await startTurn(audioBuf, attachments);
              break;
            }
          }
        } catch (err) {
          console.error('[server] Message error:', err);
        }
      });

      // Resolve ICE servers (TTL-cached) and tell the client we're ready
      const iceServers = await this.resolveIceServers();
      ws.send(JSON.stringify(createReadyMessage(connId, iceServers)));

      ws.on('close', async () => {
        console.log(`[server] Connection closed: ${connId}`);
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        cancelCurrentTurn();
        peer?.destroy();
        audioProcessor?.destroy();

        // Update active connections gauge (wss may already be torn down
        // when close events drain during stop())
        this.metrics.gauge(MetricNames.CONNECTIONS, this.wss?.clients.size ?? 0);

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

  private createPeer(ws: WebSocket, iceServers: RTCIceServer[]): NativePeerServer | null {
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
      iceServers
    });

    console.log('[server] Created NativePeerServer');
    return peer;
  }

  private setupPeerHandlers(
    peer: NativePeerServer,
    audioProcessor: AudioProcessor,
    ws: WebSocket,
    sessionId: string,
    getPendingAttachments: () => VisionAttachment[],
    setPendingAttachments: (atts: VisionAttachment[]) => void,
    getIsTTSPlaying: () => boolean,
    cancelCurrentTurn: () => void,
    getAbortController: () => AbortController | null,
    startTurn: (audio: Buffer, attachments: VisionAttachment[]) => Promise<void>,
    onPeerClosed: () => void
  ): void {
    peer.on('connect', () => {
      console.log('[server] WebRTC peer connected');
    });

    peer.on('close', () => {
      console.log('[server] WebRTC peer closed');
      audioProcessor.destroy();
      onPeerClosed();
    });

    peer.on('error', (err) => {
      console.error('[server] Peer error:', err);
      audioProcessor.destroy();
    });

    // Renegotiation can deliver additional audio tracks; VAD handlers must
    // only be attached once or every utterance would start N turns
    let vadHandlersAttached = false;

    peer.on('track', async (track: MediaStreamTrack) => {
      console.log('[server] Received track:', track.kind);

      if (track.kind === 'audio') {
        if (vadHandlersAttached) {
          return;
        }
        vadHandlersAttached = true;

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

          // Barge-in: abort the in-flight turn no matter which phase it is
          // in. Waiting for TTS to start would let the assistant talk over
          // the user when they interrupt during the LLM phase.
          if (getAbortController()) {
            const wasPlaying = getIsTTSPlaying();
            console.log('[server] User interrupted - cancelling in-flight turn');
            cancelCurrentTurn();
            if (wasPlaying) {
              this.sendBoth({ type: 'tts-cancelled' }, ws, peer);
            }
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
            const wavBuffer = audioProcessor.pcmToWav(pcmBuffer);
            console.log('[server] PCM to WAV conversion complete:', wavBuffer.length, 'bytes');
            const attachments = getPendingAttachments();
            setPendingAttachments([]);
            await startTurn(wavBuffer, attachments);
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
    ttsAudioSource?: WrtcAudioSource | null,
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
