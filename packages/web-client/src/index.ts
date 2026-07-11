import EventEmitter from 'eventemitter3';
import { z } from 'zod';
import { NativePeer } from './native-peer.js';
import {
  ConnectionStateMachine,
  ConnectionState,
  ReconnectionConfig
} from './connection-state.js';
import { PROTOCOL_VERSION, type ServerMessage } from '@llmrtc/llmrtc-core';

// Re-export for convenience
export { ConnectionState } from './connection-state.js';
export { NativePeer } from './native-peer.js';
export { PROTOCOL_VERSION } from '@llmrtc/llmrtc-core';

export interface WebClientConfig {
  signallingUrl: string;
  iceServers?: RTCIceServer[];
  /** Force WebRTC transport; WS is used only for signalling */
  useWebRTC?: boolean;
  /** Reconnection configuration (enabled by default) */
  reconnection?: Partial<ReconnectionConfig>;
}

export interface AttachmentPayload {
  data: string;
  mimeType?: string;
  alt?: string;
}

export interface ClientError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface ToolCallStartPayload {
  name: string;
  callId: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallEndPayload {
  callId: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface StageChangePayload {
  from: string;
  to: string;
  reason: string;
}

export type ClientEvents = {
  transcript: (text: string, isFinal?: boolean) => void;
  llm: (text: string) => void;
  llmChunk: (text: string) => void;
  tts: (audio: ArrayBuffer, format: string) => void;
  /** Streaming TTS audio when no WebRTC audio track is available */
  ttsChunk: (audio: ArrayBuffer, format: string, sampleRate?: number) => void;
  ttsTrack: (stream: MediaStream) => void;
  ttsStart: () => void;
  ttsComplete: () => void;
  ttsCancelled: () => void;
  speechStart: () => void;
  speechEnd: () => void;
  toolCallStart: (payload: ToolCallStartPayload) => void;
  toolCallEnd: (payload: ToolCallEndPayload) => void;
  stageChange: (payload: StageChangePayload) => void;
  error: (error: ClientError) => void;
  stateChange: (state: ConnectionState) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  /** Fired after a reconnect completes; indicates whether history was recovered */
  reconnected: (historyRecovered: boolean) => void;
};

export interface FrameCaptureController {
  stop(): void;
  getLastFrame(): string | null;
}

export interface AudioController {
  stop(): Promise<void>;
}

const MessageSchema = z.object({ type: z.string() }).passthrough();

const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 10000;
const MAX_MISSED_HEARTBEATS = 2;

/**
 * Default ICE servers - Metered STUN server
 * Used when no custom ICE servers configured and server doesn't provide any
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.metered.ca:80' }
];

export class LLMRTCWebClient extends EventEmitter<ClientEvents> {
  private ws: WebSocket | null = null;
  private peer: NativePeer | null = null;
  private stateMachine: ConnectionStateMachine;
  private sessionId: string | null = null;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private heartbeatTimeout?: ReturnType<typeof setTimeout>;
  private missedHeartbeats: number = 0;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  /**
   * Incremented on every cleanup. An in-flight reconnect attempt compares
   * its captured epoch after each await; a mismatch means close() (or a
   * newer attempt) superseded it and it must not resurrect the connection.
   */
  private connectionEpoch = 0;

  /** ICE servers received from server in ready message */
  private serverIceServers: RTCIceServer[] | null = null;

  // Media state
  private audioTrack?: MediaStreamTrack;
  private audioStream?: MediaStream;
  private audioSender?: RTCRtpSender;
  private videoCapture?: FrameCaptureController;
  private screenCapture?: FrameCaptureController;

  constructor(private readonly config: WebClientConfig) {
    super();

    // Default reconnection to enabled
    const reconnectionConfig: Partial<ReconnectionConfig> = {
      enabled: true,
      ...config.reconnection
    };

    this.stateMachine = new ConnectionStateMachine(reconnectionConfig);

    this.stateMachine.on('stateChange', ({ to }) => {
      this.emit('stateChange', to);
    });
  }

  /**
   * Get the current connection state.
   */
  get state(): ConnectionState {
    return this.stateMachine.state;
  }

  /**
   * Get the session ID assigned by the server.
   */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Start the connection to the server.
   */
  async start(): Promise<void> {
    const restartableStates = [
      ConnectionState.DISCONNECTED,
      ConnectionState.FAILED,
      ConnectionState.CLOSED
    ];
    if (!restartableStates.includes(this.stateMachine.state)) {
      throw new Error('Client already started or connecting');
    }

    this.stateMachine.resetRetries();
    this.stateMachine.transition(ConnectionState.CONNECTING);

    try {
      await this.connect();
      this.stateMachine.transition(ConnectionState.CONNECTED);
    } catch (error) {
      this.handleConnectionError(error as Error);
      throw error;
    }
  }

  private async connect(resumeSessionId?: string | null): Promise<void> {
    // 1. Establish WebSocket
    await this.connectWebSocket();

    // 2. Wait for ready message with session ID and ICE servers
    await this.waitForReady();

    // 3. Resume the previous session BEFORE negotiating the peer, so the
    //    server binds the recovered conversation to this connection
    //    (protocol order: ready -> reconnect -> reconnect-ack -> offer)
    if (resumeSessionId) {
      const recovered = await this.requestSessionResume(resumeSessionId);
      this.emit('reconnected', recovered);
    }

    // 4. Resolve ICE servers
    // Priority: client config > server-provided > default STUN
    const iceServers = this.config.iceServers?.length
      ? this.config.iceServers
      : this.serverIceServers?.length
        ? this.serverIceServers
        : DEFAULT_ICE_SERVERS;

    console.log('[web-client] Using', iceServers.length, 'ICE servers');

    // 5. Create peer connection
    this.peer = new NativePeer({ iceServers, trickle: false }, true);

    this.setupPeerEventHandlers();

    // 6. Create offer (triggers signal event which sends to server)
    await this.peer.createOffer();

    // 7. Wait for peer connection to be established
    await this.waitForPeerConnection();

    // 8. Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Send a reconnect request and wait for the ack.
   * Resolves with whether the server recovered the previous history.
   */
  private requestSessionResume(sessionId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }

      const timeout = setTimeout(() => {
        ws.removeEventListener('message', handler);
        console.warn('[web-client] Timed out waiting for reconnect-ack');
        resolve(false);
      }, 5000);

      const handler = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'reconnect-ack') {
            clearTimeout(timeout);
            ws.removeEventListener('message', handler);
            if (msg.success && msg.sessionId) {
              this.sessionId = msg.sessionId;
            }
            resolve(Boolean(msg.success && msg.historyRecovered));
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.addEventListener('message', handler);
      console.log('[web-client] Requesting session resume:', sessionId);
      ws.send(JSON.stringify({ type: 'reconnect', sessionId }));
    });
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[web-client] Connecting to', this.config.signallingUrl);
      this.ws = new WebSocket(this.config.signallingUrl);

      const onOpen = () => {
        console.log('[web-client] WebSocket connected');
        cleanup();
        resolve();
      };

      const onError = (e: Event) => {
        console.error('[web-client] WebSocket error:', e);
        cleanup();
        reject(new Error('WebSocket connection failed'));
      };

      const cleanup = () => {
        this.ws?.removeEventListener('open', onOpen);
        this.ws?.removeEventListener('error', onError);
      };

      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
      this.ws.onmessage = (ev) => this.handleSignalingMessage(ev.data);
      this.ws.onclose = () => this.handleWebSocketClose();
    });
  }

  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.removeEventListener('message', handler);
        reject(new Error('Timeout waiting for ready message'));
      }, 10000);

      const handler = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            this.sessionId = msg.id;

            // Store server-provided ICE servers
            if (msg.iceServers?.length) {
              this.serverIceServers = msg.iceServers;
              console.log('[web-client] Received', msg.iceServers.length, 'ICE servers from server');
            }

            // Check protocol version
            const serverVersion = msg.protocolVersion ?? 0;
            if (serverVersion !== PROTOCOL_VERSION) {
              console.warn(
                `[web-client] Protocol version mismatch: client=${PROTOCOL_VERSION}, server=${serverVersion}`
              );
            }

            console.log('[web-client] Session ID:', this.sessionId, 'Protocol version:', serverVersion);
            this.ws?.removeEventListener('message', handler);
            resolve();
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws?.addEventListener('message', handler);
    });
  }

  private setupPeerEventHandlers(): void {
    if (!this.peer) return;

    this.peer.on('signal', (signal) => {
      console.log('[web-client] Sending offer signal');
      this.ws?.send(JSON.stringify({ type: 'offer', signal }));
    });

    this.peer.on('data', (data) => {
      const str =
        typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
      this.handlePayload(str);
    });

    this.peer.on('connect', () => {
      console.log('[web-client] Peer connected');
    });

    this.peer.on('close', () => {
      console.log('[web-client] Peer closed');
      if (this.stateMachine.state === ConnectionState.CONNECTED) {
        this.scheduleReconnect();
      }
    });

    this.peer.on('error', (err) => {
      console.error('[web-client] Peer error:', err.message);
      this.emit('error', {
        code: 'WEBRTC_ERROR',
        message: err.message,
        recoverable: true
      });
    });

    this.peer.on('track', (track, stream) => {
      if (track.kind === 'audio') {
        console.log('[web-client] Received TTS audio track from server');
        this.emit('ttsTrack', stream);
      }
    });

    this.peer.on('connectionStateChange', (state) => {
      console.log('[web-client] Connection state changed:', state);
      if (state === 'failed' || state === 'disconnected') {
        if (this.stateMachine.state === ConnectionState.CONNECTED) {
          this.scheduleReconnect();
        }
      }
    });
  }

  private waitForPeerConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.peer?.connected) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for peer connection'));
      }, 30000);

      const onConnect = () => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        this.peer?.off('connect', onConnect);
        this.peer?.off('error', onError);
      };

      this.peer?.on('connect', onConnect);
      this.peer?.on('error', onError);
    });
  }

  private handleSignalingMessage(raw: string): void {
    try {
      const parsed = MessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;

      const msg = parsed.data as ServerMessage;

      switch (msg.type) {
        case 'signal':
          if (this.peer && !this.peer.destroyed) {
            console.log('[web-client] Received answer signal');
            this.peer.signal(msg.signal).catch((err: Error) => {
              console.error('[web-client] Failed to apply signal:', err);
              this.emit('error', {
                code: 'SIGNALING_ERROR',
                message: err.message,
                recoverable: true
              });
            });
          }
          break;

        case 'pong':
          // Reset missed heartbeats on pong
          this.missedHeartbeats = 0;
          if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = undefined;
          }
          break;

        case 'reconnect-ack':
          console.log(
            '[web-client] Reconnect acknowledged:',
            msg.historyRecovered ? 'history recovered' : 'new session',
            'sessionId:', msg.sessionId
          );
          // Update session ID to the one confirmed by the server
          // This ensures sessionId is preserved across reconnections when history is recovered
          if (msg.sessionId) {
            this.sessionId = msg.sessionId;
          }
          break;

        default:
          // Only process payload messages from WebSocket if DataChannel is NOT connected
          // This prevents duplicate message handling since backend sends to both channels
          if (!this.peer?.connected) {
            this.handlePayload(raw);
          }
          // When DataChannel is connected, ignore payload messages from WebSocket
          // They will be handled by the DataChannel's 'data' event
      }
    } catch (err) {
      console.error('[web-client] Error handling signal:', err);
    }
  }

  private handlePayload(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      switch (msg.type) {
        case 'transcript':
          this.emit('transcript', msg.text, msg.isFinal ?? true);
          break;
        case 'llm-chunk':
          if (msg.content) this.emit('llmChunk', msg.content);
          break;
        case 'llm':
          this.emit('llm', msg.text);
          break;
        case 'tts':
          if (msg.data)
            this.emit('tts', base64ToArrayBuffer(msg.data), msg.format ?? 'mp3');
          break;
        case 'tts-chunk':
          // Streaming TTS fallback when no WebRTC audio track exists
          if (msg.data)
            this.emit(
              'ttsChunk',
              base64ToArrayBuffer(msg.data),
              msg.format ?? 'pcm',
              msg.sampleRate
            );
          break;
        case 'tts-start':
          this.emit('ttsStart');
          break;
        case 'tts-complete':
          this.emit('ttsComplete');
          break;
        case 'tts-cancelled':
          this.emit('ttsCancelled');
          break;
        case 'speech-start':
          // Ship the current camera/screen frames now, while the utterance
          // is still in progress - the server snapshots attachments the
          // moment its VAD ends the turn, so sending them on speech-end
          // arrives too late to be included
          this.sendAttachments();
          this.emit('speechStart');
          break;
        case 'speech-end':
          this.emit('speechEnd');
          break;
        case 'tool-call-start':
          this.emit('toolCallStart', {
            name: msg.name,
            callId: msg.callId,
            arguments: msg.arguments ?? {}
          });
          break;
        case 'tool-call-end':
          this.emit('toolCallEnd', {
            callId: msg.callId,
            result: msg.result,
            error: msg.error,
            durationMs: msg.durationMs ?? 0
          });
          break;
        case 'stage-change':
          this.emit('stageChange', {
            from: msg.from,
            to: msg.to,
            reason: msg.reason ?? ''
          });
          break;
        case 'error':
          this.emit('error', {
            code: msg.code ?? 'SERVER_ERROR',
            message: msg.message ?? 'Unknown error',
            recoverable: false
          });
          break;
      }
    } catch (err) {
      console.error('[web-client] Error handling payload:', err);
    }
  }

  private handleWebSocketClose(): void {
    console.log('[web-client] WebSocket closed');
    if (this.stateMachine.state === ConnectionState.CONNECTED) {
      this.scheduleReconnect();
    }
  }

  private handleConnectionError(error: Error): void {
    console.error('[web-client] Connection error:', error.message);

    if (this.stateMachine.reconnectionEnabled) {
      this.scheduleReconnect();
    } else {
      this.enterFailedState('CONNECTION_ERROR', error.message);
    }
  }

  /**
   * Terminal failure: release every live resource (most importantly the
   * microphone and camera - a failed client must not keep recording) and
   * report the error.
   */
  private enterFailedState(code: string, message: string): void {
    this.stopMediaTracks();
    this.cleanup(false);
    this.stateMachine.transition(ConnectionState.FAILED);
    this.emit('error', { code, message, recoverable: false });
  }

  /** Stop microphone and capture tracks and drop the references. */
  private stopMediaTracks(): void {
    this.audioTrack?.stop();
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.audioTrack = undefined;
    this.audioStream = undefined;
    this.audioSender = undefined;

    this.videoCapture?.stop();
    this.screenCapture?.stop();
    this.videoCapture = undefined;
    this.screenCapture = undefined;
  }

  private scheduleReconnect(): void {
    if (!this.stateMachine.reconnectionEnabled) {
      this.enterFailedState('CONNECTION_ERROR', 'Connection lost');
      return;
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // The old connection's heartbeat must not fire during backoff - it
    // would burn retries against a socket we already know is dead
    this.stopHeartbeat();

    this.stateMachine.transition(ConnectionState.RECONNECTING);
    const delay = this.stateMachine.getNextRetryDelay();

    if (delay === null) {
      // Max retries exceeded
      this.enterFailedState(
        'RECONNECTION_FAILED',
        'Maximum reconnection attempts exceeded'
      );
      return;
    }

    console.log(
      `[web-client] Reconnecting in ${delay}ms (attempt ${this.stateMachine.retryCount}/${this.stateMachine.maxRetries})`
    );

    this.emit(
      'reconnecting',
      this.stateMachine.retryCount,
      this.stateMachine.maxRetries
    );

    this.reconnectTimeout = setTimeout(() => this.attemptReconnect(), delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (
      this.stateMachine.state === ConnectionState.CLOSED ||
      this.stateMachine.state === ConnectionState.FAILED
    ) {
      return;
    }

    // Save old session ID BEFORE cleanup/connect (connect() will set a new sessionId)
    const oldSessionId = this.sessionId;

    // Clean up existing connections but keep session ID
    this.cleanup(false);
    const epoch = this.connectionEpoch;

    this.stateMachine.transition(ConnectionState.CONNECTING);

    try {
      // connect() resumes the old session between ready and the offer, so
      // the recovered history is bound before any turn can run
      await this.connect(oldSessionId);

      // close() may have run while we were connecting; don't resurrect a
      // connection the user has already hung up
      if (this.connectionEpoch !== epoch) {
        console.log('[web-client] Reconnect superseded, tearing down');
        this.peer?.destroy();
        this.peer = null;
        if (this.ws) {
          this.ws.onclose = null;
          this.ws.close();
          this.ws = null;
        }
        this.stopHeartbeat();
        return;
      }

      // Re-add audio track if we had one
      if (this.audioStream && this.audioTrack && this.audioTrack.readyState === 'live') {
        console.log('[web-client] Re-adding audio track after reconnect');
        this.audioSender = this.peer?.addTrack(this.audioTrack, this.audioStream);
      }

      this.stateMachine.transition(ConnectionState.CONNECTED);
    } catch (error) {
      if (this.connectionEpoch !== epoch) {
        return;
      }
      console.error('[web-client] Reconnect attempt failed:', error);
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

        this.heartbeatTimeout = setTimeout(() => {
          this.missedHeartbeats++;
          console.warn(
            `[web-client] Missed heartbeat (${this.missedHeartbeats}/${MAX_MISSED_HEARTBEATS})`
          );

          if (
            this.missedHeartbeats >= MAX_MISSED_HEARTBEATS &&
            this.stateMachine.state === ConnectionState.CONNECTED
          ) {
            console.warn('[web-client] Too many missed heartbeats, reconnecting');
            this.scheduleReconnect();
          }
        }, HEARTBEAT_TIMEOUT_MS);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
    this.missedHeartbeats = 0;
  }

  /**
   * Share audio with the server.
   * Speech detection is handled server-side using Silero VAD.
   */
  async shareAudio(stream: MediaStream): Promise<AudioController> {
    if (!this.peer?.connected) {
      throw new Error('Peer not connected');
    }

    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('No audio track in stream');
    }

    // Sharing again replaces the previous share; two live mic tracks would
    // confuse the server's single-track VAD pipeline
    if (this.audioSender && this.peer) {
      console.log('[web-client] Replacing existing audio share');
      this.peer.removeTrack(this.audioSender);
      this.audioTrack?.stop();
    }

    this.audioStream = stream;
    this.audioTrack = track;

    console.log('[web-client] Adding audio track to peer connection');
    const sender = this.peer.addTrack(track, stream);
    this.audioSender = sender;

    // Wait for signaling to stabilize
    await this.waitForStableSignaling();

    console.log('[web-client] Audio track added - VAD handled server-side');

    return {
      stop: async () => {
        console.log('[web-client] Stopping audio sharing');
        // Only touch client state if this share is still the active one
        if (this.audioSender === sender && this.peer) {
          this.peer.removeTrack(sender);
          this.audioSender = undefined;
          this.audioTrack = undefined;
          this.audioStream = undefined;
        }
        track.stop();
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }

  private waitForStableSignaling(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const checkState = () => {
        if (!this.peer || this.peer.destroyed) {
          reject(new Error('Peer closed while waiting for stable signaling'));
          return;
        }
        if (this.peer.signalingState === 'stable') {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('Timed out waiting for stable signaling'));
          return;
        }
        setTimeout(checkState, 100);
      };
      setTimeout(checkState, 100);
    });
  }

  /**
   * Send a complete audio utterance over the signaling channel.
   * This is the non-WebRTC fallback path (e.g. when the server reports
   * WEBRTC_UNAVAILABLE): the server transcribes the buffer and replies
   * over the WebSocket, streaming TTS via 'ttsChunk'/'tts' events.
   */
  sendAudio(audio: ArrayBuffer, attachments?: AttachmentPayload[]): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('Signaling channel not open');
    }
    this.ws.send(
      JSON.stringify({
        type: 'audio',
        data: arrayBufferToBase64(audio),
        attachments: attachments ?? this.gatherAttachments()
      })
    );
  }

  /**
   * Send vision attachments to include with next speech segment.
   */
  sendAttachments(): void {
    const attachments = this.gatherAttachments();
    if (attachments.length > 0 && this.peer?.connected) {
      this.peer.send(JSON.stringify({ type: 'attachments', attachments }));
    }
  }

  private gatherAttachments(): AttachmentPayload[] {
    const attachments: AttachmentPayload[] = [];
    const cam = this.videoCapture?.getLastFrame();
    const screen = this.screenCapture?.getLastFrame();
    if (cam)
      attachments.push({ data: cam, mimeType: 'image/jpeg', alt: 'camera frame' });
    if (screen)
      attachments.push({ data: screen, mimeType: 'image/jpeg', alt: 'screen frame' });
    return attachments;
  }

  shareVideo(stream: MediaStream, intervalMs = 1000): FrameCaptureController {
    this.videoCapture?.stop();
    const ctrl = startFrameCapture(stream, intervalMs);
    this.videoCapture = ctrl;
    return ctrl;
  }

  shareScreen(stream: MediaStream, intervalMs = 1200): FrameCaptureController {
    this.screenCapture?.stop();
    const ctrl = startFrameCapture(stream, intervalMs);
    this.screenCapture = ctrl;
    return ctrl;
  }

  /**
   * Close the connection and release all media (microphone included).
   * The client can be started again with start().
   */
  close(): void {
    this.stateMachine.transition(ConnectionState.CLOSED);
    this.stopMediaTracks();
    this.cleanup(true);
  }

  private cleanup(fullCleanup: boolean): void {
    // Invalidate any in-flight reconnect attempt
    this.connectionEpoch++;

    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    this.peer?.destroy();
    this.peer = null;

    if (this.ws) {
      this.ws.onclose = null; // Prevent triggering reconnect
      this.ws.close();
      this.ws = null;
    }

    if (fullCleanup) {
      // Frame captures are local (frames travel over the data channel), so
      // they survive reconnects; they only stop on close()/failure
      this.videoCapture?.stop();
      this.screenCapture?.stop();
      this.videoCapture = undefined;
      this.screenCapture = undefined;

      this.sessionId = null;
      this.serverIceServers = null;
      this.audioTrack = undefined;
      this.audioStream = undefined;
      this.audioSender = undefined;
    }
  }
}

// Helper functions

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function recordOnce(durationMs = 4000): Promise<ArrayBuffer> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Pick a container the browser actually supports (Safari records mp4/aac,
  // Chromium and Firefox record webm)
  const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
    typeof MediaRecorder.isTypeSupported === 'function' ? MediaRecorder.isTypeSupported(t) : true
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      reject((e as unknown as { error?: Error }).error ?? new Error('Recording failed'));
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const buf = await blob.arrayBuffer();
      stream.getTracks().forEach((t) => t.stop());
      resolve(buf);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), durationMs);
  });
}

export async function captureScreenFrame(): Promise<string> {
  const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const track = screen.getVideoTracks()[0];
  const image = await grabFrame(track);
  track.stop();
  return image;
}

/** Minimal surface of the (non-universal) ImageCapture API used for frame grabs. */
interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}

/**
 * A reusable frame grabber. Uses the ImageCapture API where available
 * (Chromium) and falls back to drawing a hidden <video> element elsewhere
 * (Safari has no ImageCapture; Firefox's is unreliable).
 */
interface FrameGrabber {
  grab(): Promise<string>;
  dispose(): void;
}

function createFrameGrabber(stream: MediaStream): FrameGrabber {
  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new Error('No video track in stream');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('canvas context missing');
  }

  const ImageCaptureCtor = (window as unknown as {
    ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
  }).ImageCapture;

  if (ImageCaptureCtor) {
    const capture = new ImageCaptureCtor(track);
    return {
      grab: async () => {
        const bitmap = await capture.grabFrame();
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        ctx.drawImage(bitmap, 0, 0);
        return canvas.toDataURL('image/jpeg', 0.6);
      },
      dispose: () => {
        // Nothing to release
      }
    };
  }

  // Fallback: hidden video element
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const playing = video.play().catch(() => {
    // Autoplay of a muted, detached video element is permitted everywhere;
    // failures surface on grab() as zero dimensions
  });

  return {
    grab: async () => {
      await playing;
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('Video frame not ready');
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.6);
    },
    dispose: () => {
      video.pause();
      video.srcObject = null;
    }
  };
}

async function grabFrame(track: MediaStreamTrack): Promise<string> {
  const grabber = createFrameGrabber(new MediaStream([track]));
  try {
    return await grabber.grab();
  } finally {
    grabber.dispose();
  }
}

function startFrameCapture(
  stream: MediaStream,
  intervalMs: number
): FrameCaptureController {
  let stopped = false;
  let lastFrame: string | null = null;
  let consecutiveFailures = 0;
  const grabber = createFrameGrabber(stream);

  const tick = async () => {
    if (stopped) return;
    try {
      lastFrame = await grabber.grab();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      if (consecutiveFailures === 5) {
        console.warn(
          '[web-client] Frame capture failing repeatedly; no frames will be attached:',
          err
        );
      }
    }
    if (!stopped) {
      timer = window.setTimeout(tick, intervalMs);
    }
  };

  let timer = window.setTimeout(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      grabber.dispose();
      stream.getTracks().forEach((t) => t.stop());
    },
    getLastFrame: () => (stopped ? null : lastFrame)
  };
}
