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
try {
  const mod = await import('@roamhq/wrtc');
  wrtcLib = (mod as any).default ?? mod;
  // eslint-disable-next-line no-console
  console.log('[backend] wrtc loaded (@roamhq/wrtc), WebRTC enabled');
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
  });

  peer.on('iceStateChange', (state: string) => {
    // eslint-disable-next-line no-console
    console.log('[backend] ICE state:', state);
  });

  peer.on('data', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'audio-chunk') {
        const attachments: VisionAttachment[] = msg.attachments ?? [];
        await handleAudio(orchestrator, Buffer.from(msg.data, 'base64'), ws, peer, attachments);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('peer data error', err);
    }
  });

  peer.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('peer error', err);
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
