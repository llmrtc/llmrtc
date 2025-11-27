import SimplePeer from 'simple-peer';
import EventEmitter from 'eventemitter3';
import { z } from 'zod';

export interface WebClientConfig {
  signallingUrl: string;
  iceServers?: RTCIceServer[];
  /** force WebRTC transport; WS is used only for signalling */
  useWebRTC?: boolean;
}

export interface AttachmentPayload {
  data: string;
  mimeType?: string;
  alt?: string;
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
  error: (message: string) => void;
};

export interface FrameCaptureController {
  stop(): void;
  getLastFrame(): string | null;
}

export interface AudioController {
  stop(): Promise<void>;
}

const MessageSchema = z.object({ type: z.string() }).passthrough();

export class LLMRTCWebClient extends EventEmitter<ClientEvents> {
  private ws?: WebSocket;
  private peer?: SimplePeer.Instance;
  private useWebRTC: boolean;
  private peerReady?: Promise<void>;
  private peerResolve?: () => void;
  private videoCapture?: FrameCaptureController;
  private screenCapture?: FrameCaptureController;
  private audioTrack?: MediaStreamTrack;
  private audioStream?: MediaStream;

  constructor(private readonly config: WebClientConfig) {
    super();
    this.useWebRTC = config.useWebRTC ?? true;
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.config.signallingUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (ev) => reject(ev);
      this.ws.onmessage = (ev) => this.handleSignal(ev.data as string);
    });

    if (!this.useWebRTC) throw new Error('useWebRTC must be true for start()');

    this.peerReady = new Promise<void>((res) => (this.peerResolve = res));
    // Use provided ICE servers, or empty array for localhost (host candidates only)
    const iceServers = this.config.iceServers ?? [];
    const peerOpts: SimplePeer.Options = {
      initiator: true,
      trickle: false, // Disable trickle ICE for better compatibility with Node.js wrtc
      config: { iceServers } as RTCConfiguration
    };
    this.peer = new SimplePeer(peerOpts);
    this.peer.on('signal', (signal) => {
      // With trickle: false, we get one complete signal with SDP + all ICE candidates
      this.ws?.send(JSON.stringify({ type: 'offer', signal }));
    });
    this.peer.on('data', (data: Buffer | Uint8Array | string) => {
      const asString = typeof data === 'string' ? data : new TextDecoder().decode(data);
      this.handlePayload(asString);
    });
    this.peer.on('connect', () => {
      console.log('[web-client] Peer connected');
      this.peerResolve?.();
    });
    this.peer.on('close', () => {
      console.log('[web-client] Peer closed');
    });
    this.peer.on('error', (err) => {
      console.log('[web-client] Peer error:', err.message);
      this.emit('error', err.message);
    });
    this.peer.on('track', (track: MediaStreamTrack, stream: MediaStream) => {
      if (track.kind === 'audio') {
        console.log('[web-client] Received TTS audio track from server');
        this.emit('ttsTrack', stream);
      }
    });

    await this.peerReady;
  }

  /**
   * Share audio with the server
   * Speech detection is handled server-side using Silero VAD
   * Audio is streamed via WebRTC MediaStreamTrack
   */
  async shareAudio(stream: MediaStream): Promise<AudioController> {
    if (!this.peer?.connected) throw new Error('Peer not connected');

    // Store stream reference
    this.audioStream = stream;
    this.audioTrack = stream.getAudioTracks()[0];

    if (!this.audioTrack) {
      throw new Error('No audio track in stream');
    }

    // Add audio track to peer connection - this triggers renegotiation
    console.log('[web-client] Adding audio track to peer connection');
    this.peer!.addTrack(this.audioTrack, stream);

    // Wait for renegotiation to complete
    await new Promise<void>((resolve) => {
      const checkState = () => {
        const pc = (this.peer as any)?._pc as RTCPeerConnection;
        if (pc?.signalingState === 'stable') {
          resolve();
        } else {
          setTimeout(checkState, 100);
        }
      };
      setTimeout(checkState, 100);
    });

    console.log('[web-client] Audio track added - VAD handled server-side');

    return {
      stop: async () => {
        console.log('[web-client] Stopping audio sharing');
        this.audioTrack?.stop();
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }

  /**
   * Send vision attachments to include with next speech segment
   */
  sendAttachments() {
    const attachments = this.gatherAttachments();
    if (attachments.length > 0 && this.peer?.connected) {
      this.peer.send(JSON.stringify({ type: 'attachments', attachments }));
    }
  }

  /**
   * Gather camera and screen frame attachments
   */
  private gatherAttachments(): AttachmentPayload[] {
    const attachments: AttachmentPayload[] = [];
    const cam = this.videoCapture?.getLastFrame();
    const screen = this.screenCapture?.getLastFrame();
    if (cam) attachments.push({ data: cam, mimeType: 'image/jpeg', alt: 'camera frame' });
    if (screen) attachments.push({ data: screen, mimeType: 'image/jpeg', alt: 'screen frame' });
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

  close() {
    this.peer?.destroy();
    this.ws?.close();
  }

  private handleSignal(raw: string) {
    const parsed = MessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    const msg = parsed.data as any;
    if (msg.type === 'signal' && this.peer && !this.peer.destroyed) {
      console.log('[web-client] Received signal:', msg.signal?.type || 'candidate');
      this.peer.signal(msg.signal);
      return;
    }
    this.handlePayload(raw);
  }

  private handlePayload(raw: string) {
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
          if (msg.data) this.emit('tts', base64ToArrayBuffer(msg.data), msg.format ?? 'mp3');
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
          // Send any pending attachments when speech ends
          this.sendAttachments();
          this.emit('speechEnd');
          break;
        case 'error':
          this.emit('error', msg.message ?? 'unknown error');
          break;
        default:
          break;
      }
    } catch (err) {
      this.emit('error', (err as Error).message);
    }
  }
}

// Helpers for capturing mic once and returning ArrayBuffer
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

function startFrameCapture(stream: MediaStream, intervalMs: number): FrameCaptureController {
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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
