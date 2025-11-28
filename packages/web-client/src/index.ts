import EventEmitter from 'eventemitter3';
import { z } from 'zod';
import { NativePeer } from './native-peer.js';
import {
  ConnectionStateMachine,
  ConnectionState,
  ReconnectionConfig
} from './connection-state.js';

// Re-export for convenience
export { ConnectionState } from './connection-state.js';
export { NativePeer } from './native-peer.js';

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

export type ClientEvents = {
  transcript: (text: string) => void;
  llm: (text: string) => void;
  llmChunk: (text: string) => void;
  tts: (audio: ArrayBuffer, format: string) => void;
  ttsTrack: (stream: MediaStream) => void;
  ttsStart: () => void;
  ttsComplete: () => void;
  ttsCancelled: () => void;
  speechStart: () => void;
  speechEnd: () => void;
  error: (error: ClientError) => void;
  stateChange: (state: ConnectionState) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
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

export class LLMRTCWebClient extends EventEmitter<ClientEvents> {
  private ws: WebSocket | null = null;
  private peer: NativePeer | null = null;
  private stateMachine: ConnectionStateMachine;
  private sessionId: string | null = null;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private heartbeatTimeout?: ReturnType<typeof setTimeout>;
  private missedHeartbeats: number = 0;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;

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
    if (this.stateMachine.state !== ConnectionState.DISCONNECTED) {
      throw new Error('Client already started or connecting');
    }

    this.stateMachine.transition(ConnectionState.CONNECTING);

    try {
      await this.connect();
      this.stateMachine.transition(ConnectionState.CONNECTED);
    } catch (error) {
      this.handleConnectionError(error as Error);
      throw error;
    }
  }

  private async connect(): Promise<void> {
    // 1. Establish WebSocket
    await this.connectWebSocket();

    // 2. Wait for ready message with session ID
    await this.waitForReady();

    // 3. Create peer connection
    const iceServers = this.config.iceServers ?? [];
    this.peer = new NativePeer({ iceServers, trickle: false }, true);

    this.setupPeerEventHandlers();

    // 4. Create offer (triggers signal event which sends to server)
    await this.peer.createOffer();

    // 5. Wait for peer connection to be established
    await this.waitForPeerConnection();

    // 6. Start heartbeat
    this.startHeartbeat();
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
        reject(new Error('Timeout waiting for ready message'));
      }, 10000);

      const handler = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ready') {
            clearTimeout(timeout);
            this.sessionId = msg.id;
            console.log('[web-client] Session ID:', this.sessionId);
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

      const msg = parsed.data as any;

      switch (msg.type) {
        case 'signal':
          if (this.peer && !this.peer.destroyed) {
            console.log('[web-client] Received answer signal');
            this.peer.signal(msg.signal);
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
            msg.historyRecovered ? 'history recovered' : 'new session'
          );
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
          this.emit('transcript', msg.text);
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
          this.emit('speechStart');
          break;
        case 'speech-end':
          this.sendAttachments();
          this.emit('speechEnd');
          break;
        case 'error':
          this.emit('error', {
            code: 'SERVER_ERROR',
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
      this.stateMachine.transition(ConnectionState.FAILED);
      this.emit('error', {
        code: 'CONNECTION_ERROR',
        message: error.message,
        recoverable: false
      });
    }
  }

  private scheduleReconnect(): void {
    if (!this.stateMachine.reconnectionEnabled) {
      this.stateMachine.transition(ConnectionState.FAILED);
      return;
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.stateMachine.transition(ConnectionState.RECONNECTING);
    const delay = this.stateMachine.getNextRetryDelay();

    if (delay === null) {
      // Max retries exceeded
      this.stateMachine.transition(ConnectionState.FAILED);
      this.emit('error', {
        code: 'RECONNECTION_FAILED',
        message: 'Maximum reconnection attempts exceeded',
        recoverable: false
      });
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
    // Clean up existing connections but keep session ID
    this.cleanup(false);

    this.stateMachine.transition(ConnectionState.CONNECTING);

    try {
      await this.connect();

      // Send reconnect message to try to recover session
      if (this.sessionId) {
        this.ws?.send(
          JSON.stringify({
            type: 'reconnect',
            sessionId: this.sessionId
          })
        );
      }

      // Re-add audio track if we had one
      if (this.audioStream && this.audioTrack) {
        console.log('[web-client] Re-adding audio track after reconnect');
        this.audioSender = this.peer?.addTrack(this.audioTrack, this.audioStream);
      }

      this.stateMachine.transition(ConnectionState.CONNECTED);
    } catch (error) {
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

          if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
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

    this.audioStream = stream;
    this.audioTrack = stream.getAudioTracks()[0];

    if (!this.audioTrack) {
      throw new Error('No audio track in stream');
    }

    console.log('[web-client] Adding audio track to peer connection');
    this.audioSender = this.peer.addTrack(this.audioTrack, stream);

    // Wait for signaling to stabilize
    await this.waitForStableSignaling();

    console.log('[web-client] Audio track added - VAD handled server-side');

    return {
      stop: async () => {
        console.log('[web-client] Stopping audio sharing');
        if (this.audioSender && this.peer) {
          this.peer.removeTrack(this.audioSender);
          this.audioSender = undefined;
        }
        this.audioTrack?.stop();
        stream.getTracks().forEach((t) => t.stop());
        this.audioTrack = undefined;
        this.audioStream = undefined;
      }
    };
  }

  private waitForStableSignaling(): Promise<void> {
    return new Promise((resolve) => {
      const checkState = () => {
        if (this.peer?.signalingState === 'stable') {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      setTimeout(checkState, 100);
    });
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
   * Close the connection.
   */
  close(): void {
    this.stateMachine.transition(ConnectionState.CLOSED);
    this.cleanup(true);
  }

  private cleanup(fullCleanup: boolean): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    this.videoCapture?.stop();
    this.screenCapture?.stop();

    this.peer?.destroy();
    this.peer = null;

    if (this.ws) {
      this.ws.onclose = null; // Prevent triggering reconnect
      this.ws.close();
      this.ws = null;
    }

    if (fullCleanup) {
      this.sessionId = null;
      this.audioTrack = undefined;
      this.audioStream = undefined;
      this.audioSender = undefined;
      this.stateMachine.reset();
    }
  }
}

// Helper functions

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
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const chunks: BlobPart[] = [];
  return new Promise((resolve) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
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

async function grabFrame(track: MediaStreamTrack): Promise<string> {
  const capture: any = new (window as any).ImageCapture(track);
  const bitmap = await capture.grabFrame();
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context missing');
  ctx.drawImage(bitmap, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  return dataUrl;
}

function startFrameCapture(
  stream: MediaStream,
  intervalMs: number
): FrameCaptureController {
  const track = stream.getVideoTracks()[0];
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let lastFrame: string | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const capture: any = new (window as any).ImageCapture(track);
      const bitmap = await capture.grabFrame();
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx?.drawImage(bitmap, 0, 0);
      lastFrame = canvas.toDataURL('image/jpeg', 0.6);
    } catch (err) {
      // ignore frame errors
    }
    timer = window.setTimeout(tick, intervalMs);
  };

  let timer = window.setTimeout(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      window.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
    },
    getLastFrame: () => lastFrame
  };
}
