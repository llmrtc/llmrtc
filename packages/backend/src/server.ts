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
  ToolRegistry,
  RealtimeSpeechConfig,
  RealtimeSpeechProvider,
  RealtimeSpeechSession,
  PlaybookEngine
} from '@llmrtc/llmrtc-core';
import type {
  TurnOrchestrator,
  ToolCallStartEvent,
  ToolCallEndEvent,
  StageChangeEvent
} from './turn-orchestrator.js';
import { VoicePlaybookOrchestrator } from './voice-playbook-orchestrator.js';
import { AudioProcessor, AudioFrameQueue } from './audio-processor.js';
import { RealtimePlayback } from './realtime-playback.js';
import { RealtimeRelayOrchestrator } from './realtime-relay-orchestrator.js';
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

/**
 * Realtime relay configuration (RFC 0001, experimental).
 */
export interface RealtimeSpeechServerOptions extends RealtimeSpeechConfig {
  /** The realtime speech provider (e.g. OpenAIRealtimeSpeechProvider). */
  provider: RealtimeSpeechProvider;
  /** Session spend guardrails (enforced from M2). */
  budget?: {
    /** Wall-clock cap (default 120 minutes; 0 disables). */
    maxSessionMs?: number;
    maxTokens?: number;
    onExceeded?: 'warn' | 'end-session';
  };
  /** Keep the provider session alive across client reconnects (from M3). Default 30s; 0 disables. */
  clientReconnectGraceMs?: number;
}

export interface LLMRTCServerConfig {
  /** Providers - users must provide pre-built provider instances */
  /**
   * Pipeline providers (STT/LLM/TTS). Required unless realtimeSpeech is
   * configured, in which case they are optional (reserved for the
   * pipeline fallback).
   */
  providers?: ConversationProviders;

  /**
   * EXPERIMENTAL (RFC 0001): realtime speech-to-speech relay mode.
   * When set, sessions connect to the provider's native speech model
   * instead of running the STT-LLM-TTS pipeline. streamingSTT and
   * streamingTTS are ignored in this mode.
   */
  realtimeSpeech?: RealtimeSpeechServerOptions;

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

  /**
   * Stream microphone audio to the STT provider live during speech, so
   * interim transcripts reach the client while the user is still
   * talking. Requires an STT provider with transcribeStream support
   * (e.g. ElevenLabsScribeProvider, OpenAIRealtimeSTTProvider); falls
   * back to buffered STT otherwise. Default: false.
   */
  streamingSTT?: boolean;

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
    Omit<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions' | 'iceServers' | 'metered' | 'providers' | 'realtimeSpeech'>
  > &
    Pick<LLMRTCServerConfig, 'cors' | 'hooks' | 'metrics' | 'sentenceChunker' | 'playbook' | 'toolRegistry' | 'playbookOptions' | 'iceServers' | 'metered' | 'providers' | 'realtimeSpeech'>;
  private readonly providers?: ConversationProviders;
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
  private stopping = false;
  /** Relay sessions surviving a client drop, awaiting reconnect (RFC 0001 §9). */
  private readonly relayGrace = new Map<
    string,
    {
      relay: RealtimeRelayOrchestrator;
      playback: RealtimePlayback;
      inputSampleRate: number;
      io: { ws: WebSocket; peer: NativePeerServer | null; fatal: (error: Error) => void };
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(config: LLMRTCServerConfig) {
    this.config = {
      port: 8787,
      host: '127.0.0.1',
      systemPrompt: 'You are a helpful realtime voice assistant.',
      historyLimit: 8,
      streamingTTS: true,
      streamingSTT: false,
      heartbeatTimeout: 45000,
      ...config
    };

    this.providers = config.providers;
    if (!config.providers && !config.realtimeSpeech) {
      throw new Error('LLMRTCServer requires providers (pipeline mode) or realtimeSpeech (relay mode)');
    }
    if (config.realtimeSpeech && (config.streamingSTT || config.streamingTTS === false)) {
      console.warn('[server] streamingSTT/streamingTTS are ignored in realtime relay mode');
    }
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
    // Initialize providers (absent in relay-only configurations)
    if (this.providers) {
      await Promise.all([
        this.providers.llm.init?.(),
        this.providers.stt.init?.(),
        this.providers.tts.init?.(),
        this.providers.vision?.init?.()
      ]);
    }

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
    this.stopping = true;
    // Graced relay sessions must not outlive the server
    for (const [key, entry] of this.relayGrace) {
      clearTimeout(entry.timer);
      await entry.relay.stop().catch(() => {});
      this.relayGrace.delete(key);
    }
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
    if (!this.providers) {
      throw new Error('No pipeline providers configured (realtime relay mode)');
    }
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
    if (this.config.realtimeSpeech) {
      console.log(`  Mode: realtime relay (${this.config.realtimeSpeech.provider.name})`);
      console.log(`  Pipeline fallback: ${this.providers ? 'configured' : 'none'}`);
    } else {
      console.log(`  LLM: ${this.providers!.llm.name}`);
      console.log(`  STT: ${this.providers!.stt.name}`);
      console.log(`  TTS: ${this.providers!.tts.name}`);
      console.log(`  Vision: ${this.providers!.vision?.name ?? 'disabled'}`);
      console.log(`  Streaming TTS: ${this.config.streamingTTS ? 'enabled' : 'disabled'}`);
      console.log(`  Playbook Mode: ${this.config.playbook ? 'enabled' : 'disabled'}`);
    }
    console.log('='.repeat(60));
  }

  /**
   * Create the appropriate orchestrator based on config
   */
  private createOrchestrator(
    sessionId: string,
    orchestratorHooks: OrchestratorHooks
  ): TurnOrchestrator {
    if (!this.providers) {
      throw new Error('Pipeline orchestrator requires providers');
    }
    const providers = this.providers;
    // Playbook mode: use VoicePlaybookOrchestrator
    if (this.config.playbook && this.config.toolRegistry) {
      console.log(`[server] Creating VoicePlaybookOrchestrator for session ${sessionId}`);
      return new VoicePlaybookOrchestrator({
        providers,
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
      providers,
      streamingTTS: this.config.streamingTTS,
      sessionId,
      hooks: orchestratorHooks,
      metrics: this.metrics,
      sentenceChunker: this.config.sentenceChunker
    });
  }

  /**
   * Realtime relay mode (RFC 0001, experimental): connect the session
   * to the provider's native speech-to-speech model and relay audio in
   * both directions. Turn machinery (VAD turns, STT, LLM, TTS) is not
   * used; the transport/protocol layer is shared with pipeline mode.
   */
  private async handleRelayConnection(ws: WebSocket): Promise<boolean> {
    const rs = this.config.realtimeSpeech!;
    const connId = uuidv4();
    const connectionStartTime = Date.now();
    console.log(`[server] New realtime relay connection: ${connId}`);
    this.metrics.gauge(MetricNames.CONNECTIONS, this.wss!.clients.size);
    await callHookSafe(this.hooks.onConnection, connId, connId);
    this.emit('connection', { id: connId });

    let peer: NativePeerServer | null = null;
    let audioProcessor: AudioProcessor | null = null;
    let relay: RealtimeRelayOrchestrator | null = null;
    let playback: RealtimePlayback | null = null;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let fatalClosed = false;
    // Mutable so a reconnecting client can adopt this session's output
    // AND its failure path (fatal must close the CURRENT client)
    const io: { ws: WebSocket; peer: NativePeerServer | null; fatal: (error: Error) => void } = {
      ws,
      peer: null,
      fatal: () => {}
    };
    const graceMs = rs.clientReconnectGraceMs ?? 30000;
    let adopted:
      | {
          relay: RealtimeRelayOrchestrator;
          playback: RealtimePlayback;
          inputSampleRate: number;
          io: { ws: WebSocket; peer: NativePeerServer | null; fatal: (error: Error) => void };
        }
      | null = null;
    // The id the client reconnects with; adopted sessions keep their original
    let sessionKey = connId;

    const resetHeartbeatTimeout = () => {
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        console.log(`[server] Client ${connId} heartbeat timeout`);
        ws.close();
      }, this.config.heartbeatTimeout);
    };
    resetHeartbeatTimeout();

    const fatal = (error: Error) => {
      if (closed) return;
      fatalClosed = true;
      console.error('[server] Realtime relay fatal error:', error.message);
      // Errors the orchestrator already reported to the client (e.g.
      // BUDGET_EXCEEDED) must not produce a second, generic error
      if (error.name !== 'ReportedRelayError') {
        this.sendBoth(createErrorMessage('REALTIME_ERROR', error.message), io.ws, io.peer);
      }
      if (this.providers && error.name !== 'ReportedRelayError' && error.name !== 'RelayCapabilityError') {
        // Mid-session degradation (RFC 0001 §9): tell the client the
        // next session will run pipeline mode; its auto-reconnect lands
        // on the connect-time fallback above
        this.sendBoth({ type: 'mode-changed', mode: 'pipeline' }, io.ws, io.peer);
      }
      io.ws.close();
    };
    io.fatal = fatal;

    // Registered BEFORE any await: a socket error in the connect window
    // would otherwise crash the process, and a close would leak the
    // provider session until its 60-minute cap
    ws.on('error', (err) => {
      console.error(`[server] Relay ws error (${connId}):`, err);
    });
    ws.on('close', async () => {
      closed = true;
      console.log(`[server] Relay connection closed: ${connId}`);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
      if (relay && playback && !fatalClosed && !this.stopping && graceMs > 0) {
        // Keep the provider session alive across a client blip: mic is
        // silent, conversation state survives (RFC 0001 §9). Stash the
        // io the relay is actually bound to (the adopted one on later
        // reconnect cycles) so message routing survives cycle N+1.
        const relayIo = adopted?.io ?? io;
        const c = await connectPromise;
        const graced = {
          relay,
          playback,
          inputSampleRate: adopted?.inputSampleRate ?? (c.ok ? c.session.inputSampleRate : 24000),
          io: relayIo,
          timer: setTimeout(() => {}, 0)
        };
        clearTimeout(graced.timer);
        // Playback targets a peer that is being destroyed - drop it
        graced.playback.clear();
        // Provider death while nobody is connected: remove the entry so
        // a reconnecting client can never adopt a dead session
        relayIo.fatal = (error: Error) => {
          console.error(`[server] Graced relay ${sessionKey} died:`, error.message);
          clearTimeout(graced.timer);
          this.relayGrace.delete(sessionKey);
          void graced.relay.stop().catch(() => {});
        };
        graced.timer = setTimeout(() => {
          this.relayGrace.delete(sessionKey);
          void graced.relay.stop().catch(() => {});
          console.log(`[server] Relay grace expired for ${sessionKey}`);
        }, graceMs);
        graced.timer.unref?.();
        this.relayGrace.set(sessionKey, graced);
        console.log(`[server] Relay session ${connId} held for reconnect (${graceMs}ms grace)`);
      } else {
        await relay?.stop().catch(() => {});
      }
      if (!relay) {
        // Close the provider session whether or not connect has settled
        void connectPromise.then((c) => {
          if (c.ok) void c.session.close().catch(() => {});
        });
      }
      peer?.destroy();
      audioProcessor?.destroy();
      this.metrics.gauge(MetricNames.CONNECTIONS, this.wss?.clients.size ?? 0);
      const sessionTiming = createTimingInfo(connectionStartTime, Date.now());
      this.metrics.timing(MetricNames.SESSION_DURATION, sessionTiming.durationMs);
      await callHookSafe(this.hooks.onDisconnect, connId, sessionTiming);
      this.emit('disconnect', { id: connId });
    });

    // Playbook mode: the engine owns stage state; the session connects
    // with the initial stage's instructions/tools (RFC 0001 §5)
    const playbookEngine = this.config.playbook ? new PlaybookEngine(this.config.playbook) : undefined;
    if (this.config.playbook) {
      const unsupported = this.config.playbook.transitions.filter(
        (t) => t.condition.type !== 'llm_decision'
      );
      const clears = this.config.playbook.transitions.filter((t) => t.action.clearHistory);
      const llmConfigs = this.config.playbook.stages.filter((st) => st.llmConfig);
      if (unsupported.length || clears.length || llmConfigs.length) {
        console.warn(
          `[server] Relay-mode playbooks support llm_decision transitions only; ` +
            `${unsupported.length} other transition(s), ${clears.length} clearHistory action(s), ` +
            `and ${llmConfigs.length} per-stage llmConfig(s) will not be applied`
        );
      }
    }

    // Built ONCE and shared by the initial connect and session renewal
    // (renewal overrides instructions/tools from the live playbook stage)
    const sessionConfig: RealtimeSpeechConfig = {
      instructions: playbookEngine
        ? playbookEngine.getEffectiveSystemPrompt()
        : (rs.instructions ?? this.config.systemPrompt),
      voice: rs.voice,
      inputTranscription: rs.inputTranscription,
      transcriptionModel: rs.transcriptionModel,
      turnDetection: rs.turnDetection,
      maxOutputTokens: rs.maxOutputTokens,
      // Bounded provider-side context is the relay-mode default cost lever
      contextManagement: rs.contextManagement ?? { strategy: 'truncate', retentionRatio: 0.8 },
      tools: playbookEngine
        ? playbookEngine.getAvailableTools()
        : (rs.tools ?? this.config.toolRegistry?.getDefinitions())
    };

    // Eager provider connect, concurrent with ICE resolution, so the
    // ready message carries the true session mode (RFC 0001 3)
    const connectPromise = rs.provider
      .connect(sessionConfig)
      .then((session) => ({ ok: true as const, session }))
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error : new Error(String(error))
      }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
            resetHeartbeatTimeout();
            break;

          case 'offer':
          case 'signal': {
            if (adopted) {
              // Reconnected client: wire a fresh peer to the adopted relay
              if (!peer || peer.destroyed) {
                peer = this.createPeer(ws, await this.resolveIceServers());
                if (peer) {
                  adopted.io.peer = peer;
                  this.wireAdoptedRelayPeer(peer, adopted, ws, (ap) => {
                    audioProcessor = ap;
                  });
                }
              }
              if (peer && msg.signal) {
                const answer = await peer.handleOffer(msg.signal);
                ws.send(JSON.stringify({ type: 'signal', signal: answer }));
              }
              break;
            }
            const connected = await connectPromise;
            if (!connected.ok) return;
            if (!peer || peer.destroyed) {
              peer = this.createPeer(ws, await this.resolveIceServers());
              if (peer) {
                io.peer = peer;
                this.setupRelayPeerHandlers(peer, connected.session, {
                  sessionConfig,
                  playbookEngine,
                  io,
                  setRelay: (r) => {
                    relay = r;
                  },
                  setPlayback: (p) => {
                    playback = p;
                  },
                  setAudioProcessor: (ap) => {
                    audioProcessor = ap;
                  },
                  ws,
                  fatal
                });
              }
            }
            if (peer && msg.signal) {
              const answer = await peer.handleOffer(msg.signal);
              ws.send(JSON.stringify({ type: 'signal', signal: answer }));
            }
            break;
          }

          case 'audio':
            // No buffered-turn path exists in relay mode (RFC 0001 3)
            ws.send(
              JSON.stringify(
                createErrorMessage('INVALID_MESSAGE', 'Realtime relay mode requires the WebRTC audio track')
              )
            );
            break;

          case 'attachments':
            // Vision input is a v1 non-goal in relay mode (RFC 0001)
            console.warn('[server] Ignoring attachments in realtime relay mode');
            break;

          case 'reconnect': {
            const graced = typeof msg.sessionId === 'string' ? this.relayGrace.get(msg.sessionId) : undefined;
            if (graced) {
              // Adopt the surviving session: its output now targets this
              // ws; this connection's own eager session is redundant
              this.relayGrace.delete(msg.sessionId);
              clearTimeout(graced.timer);
              graced.io.ws = ws;
              graced.io.peer = null;
              graced.io.fatal = fatal;
              adopted = graced;
              sessionKey = msg.sessionId;
              relay = graced.relay;
              playback = graced.playback;
              void connectPromise.then((c) => {
                if (c.ok) void c.session.close().catch(() => {});
              });
              console.log(`[server] Relay session ${msg.sessionId} adopted by ${connId}`);
              ws.send(
                JSON.stringify({
                  type: 'reconnect-ack',
                  success: true,
                  sessionId: msg.sessionId,
                  historyRecovered: true
                })
              );
            } else {
              // Nothing to resume: transcript-level recovery only (§9)
              ws.send(
                JSON.stringify({
                  type: 'reconnect-ack',
                  success: false,
                  sessionId: connId,
                  historyRecovered: false
                })
              );
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('[server] Relay message error:', err);
      }
    });

    const [iceServers, connected] = await Promise.all([this.resolveIceServers(), connectPromise]);
    if (adopted) {
      // Reconnected client already owns a live session; its redundant
      // eager connect (even a failed one) is irrelevant
      return true;
    }
    if (closed) {
      // Client left during the connect window; the close handler above
      // already arranged provider-session cleanup
      return true;
    }
    if (!connected.ok) {
      console.error('[server] Realtime provider connect failed:', connected.error.message);
      if (this.providers) {
        // Hand the connection to the pipeline path (RFC 0001 §9): drop
        // every relay handler registered above so the pipeline path can
        // wire its own without duplicates
        if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
        ws.removeAllListeners('message');
        ws.removeAllListeners('close');
        // The relay 'error' listener stays: a socket error in the gap
        // before the pipeline path registers its own would otherwise
        // crash the process (worst case now is a duplicate log line).
        // Pair this connection id's lifecycle before handing off - the
        // pipeline path announces its own id.
        await callHookSafe(this.hooks.onDisconnect, connId, createTimingInfo(connectionStartTime, Date.now()));
        this.emit('disconnect', { id: connId });
        console.log(`[server] Relay ${connId} handing off to pipeline mode (new connection id follows)`);
        return false;
      }
      ws.send(JSON.stringify(createErrorMessage('REALTIME_ERROR', connected.error.message)));
      ws.close();
      return true;
    }
    ws.send(JSON.stringify(createReadyMessage(connId, iceServers, 'realtime')));
    return true;
  }

  /** Wire a reconnecting client's fresh peer to an adopted relay session. */
  private wireAdoptedRelayPeer(
    peer: NativePeerServer,
    adopted: {
      relay: RealtimeRelayOrchestrator;
      playback: RealtimePlayback;
      inputSampleRate: number;
    },
    ws: WebSocket,
    setAudioProcessor: (ap: AudioProcessor) => void
  ): void {
    let audioWired = false;
    peer.on('track', (track: MediaStreamTrack) => {
      if (track.kind !== 'audio' || audioWired) return;
      audioWired = true;
      if (!peer.ttsAudioSource || !this.RTCAudioSource) {
        this.sendBoth(
          createErrorMessage('REALTIME_ERROR', 'Realtime relay mode requires native WebRTC audio support'),
          ws,
          peer
        );
        ws.close();
        return;
      }
      adopted.playback.setSource(peer.ttsAudioSource);
      const audioProcessor = new AudioProcessor({
        passThrough: true,
        speechFrameSampleRate: adopted.inputSampleRate
      });
      setAudioProcessor(audioProcessor);
      audioProcessor.on('speechFrame', (frame: Buffer) => adopted.relay.sendAudio(frame));
      peer.on('audioData', async (data: AudioData) => {
        await audioProcessor.processPCMData(data);
      });
      peer.on('close', () => ws.close());
      peer.on('error', () => ws.close());
    });
  }

  private setupRelayPeerHandlers(
    peer: NativePeerServer,
    session: RealtimeSpeechSession,
    ctx: {
      sessionConfig: RealtimeSpeechConfig;
      playbookEngine?: PlaybookEngine;
      io: { ws: WebSocket; peer: NativePeerServer | null; fatal: (error: Error) => void };
      setRelay: (r: RealtimeRelayOrchestrator) => void;
      setPlayback: (p: RealtimePlayback) => void;
      setAudioProcessor: (ap: AudioProcessor) => void;
      ws: WebSocket;
      fatal: (error: Error) => void;
    }
  ): void {
    let audioWired = false;

    peer.on('track', (track: MediaStreamTrack) => {
      if (track.kind !== 'audio' || audioWired) return;
      audioWired = true;

      if (!peer.ttsAudioSource || !this.RTCAudioSource) {
        const err = new Error('Realtime relay mode requires native WebRTC audio support');
        // Reconnecting cannot fix a capability gap - suppress the
        // mode-changed fallback hint for this error class
        err.name = 'RelayCapabilityError';
        ctx.fatal(err);
        return;
      }

      // Pass-through tee: every mic frame resampled to the provider's
      // input rate; turn detection is provider-side (no VAD)
      const audioProcessor = new AudioProcessor({
        passThrough: true,
        speechFrameSampleRate: session.inputSampleRate
      });
      ctx.setAudioProcessor(audioProcessor);

      const playback = new RealtimePlayback(peer.ttsAudioSource, session.outputSampleRate, (err) =>
        console.error('[server] Relay playback error:', err.message)
      );
      ctx.setPlayback(playback);

      const rs = this.config.realtimeSpeech!;
      const relay = new RealtimeRelayOrchestrator({
        session,
        playback,
        callbacks: {
          // Routed through the mutable io holder so an adopted reconnect
          // redirects output to the new client transparently
          send: (message) => this.sendBoth(message, ctx.io.ws, ctx.io.peer),
          onFatal: (error) => ctx.io.fatal(error)
        },
        metrics: this.metrics,
        toolRegistry: this.config.toolRegistry,
        provider: rs.provider,
        sessionConfig: ctx.sessionConfig,
        budget: rs.budget,
        playbookEngine: ctx.playbookEngine
      });
      ctx.setRelay(relay);

      audioProcessor.on('speechFrame', (frame: Buffer) => {
        relay.sendAudio(frame);
      });
      peer.on('audioData', async (data: AudioData) => {
        await audioProcessor.processPCMData(data);
      });

      void relay.start();
    });

    // No re-offer support until the M3 reconnect grace window: a dead
    // peer would otherwise leave the session mic-dead (or a naive rewire
    // would attach a second consumer to the session's event queue)
    peer.on('close', () => {
      console.log('[server] Relay peer closed - ending connection');
      ctx.ws.close();
    });
    peer.on('error', (err) => {
      console.error('[server] Relay peer error:', err);
      ctx.ws.close();
    });
  }

  private setupWebSocketServer(): void {
    if (!this.wss) return;

    // The ws server re-emits underlying http server errors; without a
    // listener an EADDRINUSE would crash the process instead of surfacing
    // through start()/the error handler
    this.wss.on('error', (err) => this.emit('error', err));

    this.wss.on('connection', async (ws) => {
      if (this.config.realtimeSpeech) {
        const handled = await this.handleRelayConnection(ws);
        if (handled) return;
        // Connect-time pipeline fallback (RFC 0001 §9): the provider was
        // unreachable and pipeline providers are configured
        console.warn('[server] Realtime provider unavailable - falling back to pipeline mode');
      }
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

      /** Start a serialized, abortable turn from an audio source. */
      const startTurnFromSource = (
        source: Buffer | AsyncIterable<Buffer>,
        attachments: VisionAttachment[]
      ): Promise<void> => {
        cancelCurrentTurn();
        const abortController = new AbortController();
        currentAbortController = abortController;

        return enqueueTurn(() =>
          this.handleAudio(
            session.orchestrator,
            source,
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

      /** Start a serialized, abortable turn from an audio buffer. */
      const startTurn = (audioBuf: Buffer, attachments: VisionAttachment[]): Promise<void> =>
        startTurnFromSource(audioBuf, attachments);

      /**
       * Streaming STT is active when enabled in config AND the provider
       * can stream AND the session's orchestrator has the streaming entry
       * point. Evaluated when the peer is created; the returned starter
       * reads the live session at call time.
       */
      const streamingTurnStarter = ():
        | ((frames: AsyncIterable<Buffer>, attachments: VisionAttachment[]) => Promise<void>)
        | undefined => {
        if (!this.config.streamingSTT) return undefined;
        if (typeof this.providers?.stt.transcribeStream !== 'function') return undefined;
        if (typeof session.orchestrator.runTurnStreamFromAudioStream !== 'function') return undefined;
        return (frames, attachments) => startTurnFromSource(frames, attachments);
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
                  const startStreamingTurn = streamingTurnStarter();
                  audioProcessor = new AudioProcessor(
                    startStreamingTurn
                      ? {
                          emitSpeechFrames: true,
                          speechFrameSampleRate:
                            this.providers?.stt.streamingInputSampleRate ?? 16000
                        }
                      : undefined
                  );
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
                    },
                    startStreamingTurn
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
      ws.send(JSON.stringify(createReadyMessage(connId, iceServers, 'pipeline')));

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
    onPeerClosed: () => void,
    startTurnFromStream?: (frames: AsyncIterable<Buffer>, attachments: VisionAttachment[]) => Promise<void>
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
        // Streaming STT: the live utterance queue for the current speech
        // segment. Frames are pushed as they arrive; ended at speechEnd.
        let activeSpeechQueue: AudioFrameQueue | null = null;

        audioProcessor.on('speechFrame', (frame: Buffer) => {
          activeSpeechQueue?.push(frame);
        });

        audioProcessor.on('vadMisfire', () => {
          // Too short to be speech: end the live stream; the (near-)empty
          // transcript is discarded by the orchestrator's guard
          if (activeSpeechQueue) {
            console.log('[server] VAD misfire - closing streaming STT segment');
            activeSpeechQueue.end();
            activeSpeechQueue = null;
          }
        });

        audioProcessor.on('destroyed', () => {
          // Connection/peer teardown mid-speech: end the live stream so
          // the in-flight STT turn can finalize instead of waiting on
          // frames that will never arrive
          if (activeSpeechQueue) {
            console.log('[server] Audio processor destroyed - closing streaming STT segment');
            activeSpeechQueue.end();
            activeSpeechQueue = null;
          }
        });

        audioProcessor.on('speechStart', async () => {
          console.log('[server] VAD detected speech start');
          speechStartTime = Date.now();

          // Barge-in: abort the in-flight turn no matter which phase it is
          // in. Waiting for TTS to start would let the assistant talk over
          // the user when they interrupt during the LLM phase.
          // (Synchronous, before any await: with streaming STT the new
          // turn must be listening before pre-speech frames are flushed.)
          if (getAbortController()) {
            const wasPlaying = getIsTTSPlaying();
            console.log('[server] User interrupted - cancelling in-flight turn');
            cancelCurrentTurn();
            if (wasPlaying) {
              this.sendBoth({ type: 'tts-cancelled' }, ws, peer);
            }
          }

          // Streaming STT: open the live frame stream and start the turn
          // now, at speech start, instead of waiting for speech end
          if (startTurnFromStream) {
            activeSpeechQueue?.end();
            activeSpeechQueue = new AudioFrameQueue();
            const attachments = getPendingAttachments();
            setPendingAttachments([]);
            void startTurnFromStream(activeSpeechQueue, attachments);
          }

          this.sendBoth({ type: 'speech-start' }, ws, peer);

          // Call onSpeechStart hook
          await callHookSafe(this.hooks.onSpeechStart, sessionId, speechStartTime);
        });

        audioProcessor.on('speechEnd', async (pcmBuffer: Buffer) => {
          const speechEndTime = Date.now();
          const audioDurationMs = speechEndTime - speechStartTime;
          console.log('[server] VAD detected speech end, processing', pcmBuffer.length, 'bytes');

          // Call onSpeechEnd hook
          await callHookSafe(this.hooks.onSpeechEnd, sessionId, speechEndTime, audioDurationMs);

          this.sendBoth({ type: 'speech-end' }, ws, peer);

          // Streaming STT: the turn is already running on live frames -
          // ending the queue lets the STT provider finalize the transcript
          if (activeSpeechQueue) {
            activeSpeechQueue.end();
            activeSpeechQueue = null;
            return;
          }

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
    audio: Buffer | AsyncIterable<Buffer>,
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

    const buffered = Buffer.isBuffer(audio);
    console.log(
      buffered
        ? `[server] handleAudio - processing ${(audio as Buffer).length} bytes`
        : '[server] handleAudio - processing live audio stream'
    );

    let pcmFeederState: PCMFeederState | null = null;
    let ttsStarted = false;

    if (!buffered && typeof orchestrator.runTurnStreamFromAudioStream !== 'function') {
      throw new Error('Orchestrator does not support streaming STT turns');
    }
    const turn = buffered
      ? orchestrator.runTurnStream(audio as Buffer, attachments, { signal })
      : orchestrator.runTurnStreamFromAudioStream!(audio as AsyncIterable<Buffer>, attachments, { signal });

    try {
      for await (const item of turn) {
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
