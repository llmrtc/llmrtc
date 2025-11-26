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
  error: (message: string) => void;
};

export interface ShareAudioOptions {
  /** energy threshold 0-1 for VAD */
  vadThreshold?: number;
  /** ms of silence to treat as stop */
  vadSilenceMs?: number;
  /** media recorder chunk timeslice ms */
  chunkMs?: number;
}

export interface FrameCaptureController {
  stop(): void;
  getLastFrame(): string | null;
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

    await this.peerReady;
  }

  async shareAudio(stream: MediaStream, opts: ShareAudioOptions = {}) {
    if (!this.peer?.connected) throw new Error('Peer not connected');
    const vadThreshold = opts.vadThreshold ?? 0.015;
    const vadSilenceMs = opts.vadSilenceMs ?? 600;
    const chunkMs = opts.chunkMs ?? 400;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const data = new Uint8Array(analyser.fftSize);
    source.connect(analyser);

    let speaking = false;
    let silenceStart = performance.now();
    let recorder: MediaRecorder | null = null;
    const chunks: BlobPart[] = [];

    const startRecording = () => {
      if (recorder) return;
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(chunkMs);
    };

    const stopRecording = async () => {
      if (!recorder) return;
      const done = new Promise<void>((resolve) => {
        recorder!.onstop = () => resolve();
      });
      recorder.stop();
      await done;
      recorder = null;
      if (chunks.length) {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        chunks.length = 0;
        const buf = await blob.arrayBuffer();
        const attachments: AttachmentPayload[] = [];
        const cam = this.videoCapture?.getLastFrame();
        const screen = this.screenCapture?.getLastFrame();
        if (cam) attachments.push({ data: cam, mimeType: 'image/jpeg', alt: 'camera frame' });
        if (screen) attachments.push({ data: screen, mimeType: 'image/jpeg', alt: 'screen frame' });
        this.sendAudio(Buffer.from(buf), attachments);
      }
    };

    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();

      if (rms > vadThreshold) {
        if (!speaking) startRecording();
        speaking = true;
        silenceStart = now;
      } else if (speaking && now - silenceStart > vadSilenceMs) {
        speaking = false;
        stopRecording();
      }

      rafId = requestAnimationFrame(loop);
    };

    let rafId = requestAnimationFrame(loop);

    return {
      stop: async () => {
        cancelAnimationFrame(rafId);
        await stopRecording();
        stream.getTracks().forEach((t) => t.stop());
        await audioCtx.close();
      }
    };
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

  private sendAudio(buffer: ArrayBuffer | Buffer, attachments: AttachmentPayload[] = []) {
    const b = buffer instanceof Buffer ? buffer : Buffer.from(new Uint8Array(buffer));
    const payload = { type: 'audio', data: b.toString('base64'), attachments };
    const data = JSON.stringify(payload);
    console.log('[web-client] sendAudio - size:', data.length, 'bytes');

    // Send over WebSocket (more reliable for large payloads)
    // Data channel has size limits that make it unsuitable for audio chunks
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      throw new Error('WebSocket not connected');
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
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
