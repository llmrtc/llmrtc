import { config } from 'dotenv';
import { resolve } from 'path';
// Load .env from root directory (npm scripts run from workspace root)
config({ path: resolve(process.cwd(), '.env') });

import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import SimplePeer from 'simple-peer';

import {
  ConversationOrchestrator,
  VisionAttachment,
  ConversationProviders
} from '@metered/llmrtc-core';
import { AudioProcessor } from './audio-processor.js';
import {
  OpenAILLMProvider,
  OpenAIWhisperProvider
} from '@metered/llmrtc-provider-openai';
import { ElevenLabsTTSProvider } from '@metered/llmrtc-provider-elevenlabs';
import {
  LlavaVisionProvider,
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@metered/llmrtc-provider-local';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const HOST = process.env.HOST ?? '127.0.0.1';

// eslint-disable-next-line no-console
console.log('[backend] Env loaded - OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'set' : 'NOT SET', 'ELEVENLABS_API_KEY:', process.env.ELEVENLABS_API_KEY ? 'set' : 'NOT SET');

let wrtcLib: any = null;
let RTCAudioSink: any = null;
try {
  const mod = await import('@roamhq/wrtc');
  wrtcLib = (mod as any).default ?? mod;
  // Get nonstandard APIs for audio sink
  RTCAudioSink = wrtcLib.nonstandard?.RTCAudioSink;
  // eslint-disable-next-line no-console
  console.log('[backend] wrtc loaded (@roamhq/wrtc), WebRTC enabled');
  // eslint-disable-next-line no-console
  console.log('[backend] RTCAudioSink available:', !!RTCAudioSink);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[backend] wrtc not available, falling back to WebSocket-only');
}

const app = express();
app.use(cors());
app.get('/health', (_req: express.Request, res: express.Response) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const sharedProviders: ConversationProviders = {
  llm: process.env.LOCAL_ONLY === 'true'
    ? new OllamaLLMProvider({})
    : new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY ?? '', baseURL: process.env.OPENAI_BASE_URL }),
  stt: process.env.LOCAL_ONLY === 'true'
    ? new FasterWhisperProvider({ baseUrl: process.env.FASTER_WHISPER_URL })
    : new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY ?? '', baseURL: process.env.OPENAI_BASE_URL }),
  tts: process.env.LOCAL_ONLY === 'true'
    ? new PiperTTSProvider({ baseUrl: process.env.PIPER_URL })
    : new ElevenLabsTTSProvider({ apiKey: process.env.ELEVENLABS_API_KEY ?? '' }),
  vision: process.env.LOCAL_ONLY === 'true' ? new LlavaVisionProvider({}) : undefined
};

// Initialise shared provider clients once
Promise.all([
  sharedProviders.llm.init?.(),
  sharedProviders.stt.init?.(),
  sharedProviders.tts.init?.(),
  sharedProviders.vision?.init?.()
]).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[startup] failed to init providers', err);
});

wss.on('connection', (ws) => {
  const connId = uuidv4();
  const orchestrator = new ConversationOrchestrator({
    systemPrompt: 'You are a helpful realtime voice assistant.',
    historyLimit: 8,
    providers: sharedProviders
  });
  let peer: SimplePeer.Instance | null = null;

  ws.send(JSON.stringify({ type: 'ready', id: connId }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'offer' || msg.type === 'signal') {
        // eslint-disable-next-line no-console
        console.log('[backend] Received', msg.type, '- peer exists:', !!peer, 'destroyed:', peer?.destroyed);
        // Create peer on first signal, reuse for subsequent ones
        if (!peer || peer.destroyed) {
          // eslint-disable-next-line no-console
          console.log('[backend] Creating new peer');
          peer = createPeer(ws, orchestrator);
        }
        if (peer && !peer.destroyed) {
          // eslint-disable-next-line no-console
          console.log('[backend] Signaling peer with', msg.signal?.type || 'candidate');
          peer.signal(msg.signal);
        }
        return;
      }
      if (msg.type === 'audio') {
        // eslint-disable-next-line no-console
        console.log('[backend] Received audio message, size:', msg.data?.length, 'bytes');
        const audioBuf = Buffer.from(msg.data, 'base64');
        const attachments: VisionAttachment[] = msg.attachments ?? [];
        await handleAudio(orchestrator, audioBuf, ws, peer, attachments);
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('ws message error', err);
    }
  });

  ws.on('close', () => {
    peer?.destroy();
  });
});

function createPeer(ws: WebSocket, orchestrator: ConversationOrchestrator): SimplePeer.Instance | null {
  if (!wrtcLib) {
    ws.send(JSON.stringify({ type: 'error', message: 'WebRTC not available on server' }));
    return null;
  }

  // Create audio processor for PCM buffering
  const audioProcessor = new AudioProcessor();
  let pendingAttachments: VisionAttachment[] = [];
  let audioSink: any = null;

  const peer = new SimplePeer({
    initiator: false,
    trickle: false, // Disable trickle ICE for better compatibility
    wrtc: wrtcLib,
    config: {
      iceServers: [] // Empty for localhost - host candidates only
    }
  });

  peer.on('signal', (signal) => {
    // eslint-disable-next-line no-console
    console.log('[backend] Sending signal:', signal.type || 'ice candidate');
    ws.send(JSON.stringify({ type: 'signal', signal }));
  });

  peer.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[backend] WebRTC peer connected, channel open');
  });

  peer.on('close', () => {
    // eslint-disable-next-line no-console
    console.log('[backend] WebRTC peer closed');
    if (audioSink) {
      audioSink.stop();
      audioSink = null;
    }
    audioProcessor.destroy();
  });

  peer.on('iceStateChange', (state: string) => {
    // eslint-disable-next-line no-console
    console.log('[backend] ICE state:', state);
  });

  // Handle incoming audio track from client using RTCAudioSink
  peer.on('track', (track: MediaStreamTrack, stream: MediaStream) => {
    // eslint-disable-next-line no-console
    console.log('[backend] Received track:', track.kind, 'id:', track.id, 'readyState:', track.readyState);

    if (track.kind === 'audio' && RTCAudioSink) {
      // eslint-disable-next-line no-console
      console.log('[backend] Setting up RTCAudioSink for audio track');

      // Create RTCAudioSink to receive decoded PCM samples
      audioSink = new RTCAudioSink(track);

      audioSink.ondata = (data: {
        samples: Int16Array;
        sampleRate: number;
        bitsPerSample: number;
        channelCount: number;
        numberOfFrames: number;
      }) => {
        // Only process if we're capturing (between audio-start and audio-process)
        if (audioProcessor.capturing) {
          audioProcessor.processPCMData(data);
        }
      };

      // eslint-disable-next-line no-console
      console.log('[backend] RTCAudioSink set up successfully');
    } else if (track.kind === 'audio' && !RTCAudioSink) {
      // eslint-disable-next-line no-console
      console.warn('[backend] RTCAudioSink not available - audio track cannot be processed');
    }
  });

  peer.on('data', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        // MediaStreamTrack-based audio signals
        case 'audio-start':
          // eslint-disable-next-line no-console
          console.log('[backend] Speech started - beginning audio capture');
          audioProcessor.startCapture();
          break;

        case 'audio-process':
          // eslint-disable-next-line no-console
          console.log('[backend] Speech ended - processing audio with', msg.attachments?.length || 0, 'attachments');
          pendingAttachments = msg.attachments ?? [];

          const pcmBuffer = audioProcessor.stopCapture();

          if (pcmBuffer.length > 0) {
            // Convert PCM to WAV for STT providers
            const wavBuffer = audioProcessor.pcmToWav(pcmBuffer);
            // eslint-disable-next-line no-console
            console.log('[backend] PCM to WAV conversion complete:', wavBuffer.length, 'bytes');
            await handleAudio(orchestrator, wavBuffer, ws, peer, pendingAttachments);
          } else {
            // eslint-disable-next-line no-console
            console.log('[backend] No audio data captured');
            sendBoth({ type: 'error', message: 'No audio data captured' }, ws, peer);
          }
          pendingAttachments = [];
          break;

        default:
          // eslint-disable-next-line no-console
          console.log('[backend] Unknown message type:', msg.type);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('peer data error', err);
    }
  });

  peer.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('peer error', err);
    if (audioSink) {
      audioSink.stop();
      audioSink = null;
    }
    audioProcessor.destroy();
  });

  return peer;
}

async function handleAudio(
  orchestrator: ConversationOrchestrator,
  audio: Buffer,
  ws: WebSocket,
  peer: SimplePeer.Instance | null,
  attachments: VisionAttachment[]
) {
  // eslint-disable-next-line no-console
  console.log('[backend] handleAudio - processing', audio.length, 'bytes');
  try {
    for await (const item of orchestrator.runTurnStream(audio, attachments)) {
      // eslint-disable-next-line no-console
      console.log('[backend] orchestrator yielded:', Object.keys(item));
      if ('isFinal' in item) {
        sendBoth({ type: 'transcript', text: item.text, isFinal: item.isFinal }, ws, peer);
      } else if ('done' in item) {
        sendBoth({ type: 'llm-chunk', content: item.content, done: item.done }, ws, peer);
      } else if ('fullText' in item) {
        sendBoth({ type: 'llm', text: item.fullText }, ws, peer);
      } else if ('audio' in item) {
        sendBoth({
          type: 'tts',
          format: item.format,
          data: item.audio.toString('base64')
        }, ws, peer);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('handleAudio error', err);
    sendBoth({ type: 'error', message: (err as Error).message }, ws, peer);
  }
}

function sendBoth(payload: unknown, ws: WebSocket, peer: SimplePeer.Instance | null) {
  const data = JSON.stringify(payload);
  if (ws.readyState === ws.OPEN) ws.send(data);
  if (peer?.connected) peer.send(data);
}

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`@metered/LLMRTC backend listening on ${HOST}:${PORT}`);
});
