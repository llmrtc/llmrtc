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
import { decodeToPCM, feedAudioToSource } from './mp3-decoder.js';
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
let RTCAudioSource: any = null;
try {
  const mod = await import('@roamhq/wrtc');
  wrtcLib = (mod as any).default ?? mod;
  // Get nonstandard APIs for audio sink/source
  RTCAudioSink = wrtcLib.nonstandard?.RTCAudioSink;
  RTCAudioSource = wrtcLib.nonstandard?.RTCAudioSource;
  // eslint-disable-next-line no-console
  console.log('[backend] wrtc loaded (@roamhq/wrtc), WebRTC enabled');
  // eslint-disable-next-line no-console
  console.log('[backend] RTCAudioSink available:', !!RTCAudioSink, 'RTCAudioSource available:', !!RTCAudioSource);
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

  // TTS playback state for barge-in support
  let currentAbortController: AbortController | null = null;
  let isTTSPlaying = false;

  // Cancel current TTS playback (called on user interruption)
  function cancelCurrentTTS() {
    if (currentAbortController) {
      console.log('[backend] Cancelling current TTS playback');
      currentAbortController.abort();
      currentAbortController = null;
    }
    isTTSPlaying = false;
  }

  // Create TTS audio source for sending audio back to client
  let ttsAudioSource: any = null;
  let ttsAudioTrack: MediaStreamTrack | null = null;
  if (RTCAudioSource) {
    ttsAudioSource = new RTCAudioSource();
    ttsAudioTrack = ttsAudioSource.createTrack();
    // eslint-disable-next-line no-console
    console.log('[backend] Created TTS audio track via RTCAudioSource');
  }

  const peer = new SimplePeer({
    initiator: false,
    trickle: false, // Disable trickle ICE for better compatibility
    wrtc: wrtcLib,
    config: {
      iceServers: [] // Empty for localhost - host candidates only
    }
  });

  // Add TTS audio track to peer connection for sending audio to client
  if (ttsAudioTrack) {
    const ttsStream = new wrtcLib.MediaStream([ttsAudioTrack]);
    peer.addTrack(ttsAudioTrack, ttsStream);
    // eslint-disable-next-line no-console
    console.log('[backend] Added TTS audio track to peer connection');
  }

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
  peer.on('track', async (track: MediaStreamTrack, stream: MediaStream) => {
    // eslint-disable-next-line no-console
    console.log('[backend] Received track:', track.kind, 'id:', track.id, 'readyState:', track.readyState);

    if (track.kind === 'audio' && RTCAudioSink) {
      // eslint-disable-next-line no-console
      console.log('[backend] Setting up RTCAudioSink for audio track');

      // Initialize VAD for this audio processor
      try {
        await audioProcessor.initVAD();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[backend] Failed to initialize VAD:', err);
      }

      // Listen for speech events from VAD
      audioProcessor.on('speechStart', () => {
        // eslint-disable-next-line no-console
        console.log('[backend] VAD detected speech start');

        // Barge-in: If TTS is playing, cancel it immediately
        if (isTTSPlaying) {
          console.log('[backend] User interrupted TTS - cancelling playback');
          cancelCurrentTTS();
          sendBoth({ type: 'tts-cancelled' }, ws, peer);
        }

        sendBoth({ type: 'speech-start' }, ws, peer);
      });

      audioProcessor.on('speechEnd', async (pcmBuffer: Buffer) => {
        // eslint-disable-next-line no-console
        console.log('[backend] VAD detected speech end, processing', pcmBuffer.length, 'bytes');
        sendBoth({ type: 'speech-end' }, ws, peer);

        if (pcmBuffer.length > 0) {
          // Cancel any previous response generation
          cancelCurrentTTS();

          // Create new abort controller for this turn
          currentAbortController = new AbortController();
          const signal = currentAbortController.signal;

          // Convert PCM to WAV for STT providers
          const wavBuffer = audioProcessor.pcmToWav(pcmBuffer);
          // eslint-disable-next-line no-console
          console.log('[backend] PCM to WAV conversion complete:', wavBuffer.length, 'bytes');

          await handleAudio(orchestrator, wavBuffer, ws, peer, pendingAttachments, ttsAudioSource, {
            signal,
            onTTSStart: () => { isTTSPlaying = true; },
            onTTSEnd: () => { isTTSPlaying = false; currentAbortController = null; }
          });
          pendingAttachments = [];
        }
      });

      // Create RTCAudioSink to receive decoded PCM samples
      audioSink = new RTCAudioSink(track);

      audioSink.ondata = (data: {
        samples: Int16Array;
        sampleRate: number;
        bitsPerSample: number;
        channelCount: number;
        numberOfFrames: number;
      }) => {
        // Process all audio through VAD - it handles speech detection automatically
        audioProcessor.processPCMData(data);
      };

      // eslint-disable-next-line no-console
      console.log('[backend] RTCAudioSink set up successfully with server-side VAD');
    } else if (track.kind === 'audio' && !RTCAudioSink) {
      // eslint-disable-next-line no-console
      console.warn('[backend] RTCAudioSink not available - audio track cannot be processed');
    }
  });

  peer.on('data', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        // Vision attachments from frontend
        case 'attachments':
          // Store attachments to include with next speech segment
          pendingAttachments = msg.attachments ?? [];
          // eslint-disable-next-line no-console
          console.log('[backend] Received attachments:', pendingAttachments.length);
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

interface HandleAudioOptions {
  signal?: AbortSignal;
  onTTSStart?: () => void;
  onTTSEnd?: () => void;
}

async function handleAudio(
  orchestrator: ConversationOrchestrator,
  audio: Buffer,
  ws: WebSocket,
  peer: SimplePeer.Instance | null,
  attachments: VisionAttachment[],
  ttsAudioSource?: any,
  options?: HandleAudioOptions
) {
  const { signal, onTTSStart, onTTSEnd } = options ?? {};

  // eslint-disable-next-line no-console
  console.log('[backend] handleAudio - processing', audio.length, 'bytes');
  try {
    for await (const item of orchestrator.runTurnStream(audio, attachments)) {
      // Check if cancelled before processing each item
      if (signal?.aborted) {
        console.log('[backend] Response generation cancelled by user interruption');
        break;
      }

      // eslint-disable-next-line no-console
      console.log('[backend] orchestrator yielded:', Object.keys(item));
      if ('isFinal' in item) {
        sendBoth({ type: 'transcript', text: item.text, isFinal: item.isFinal }, ws, peer);
      } else if ('done' in item) {
        sendBoth({ type: 'llm-chunk', content: item.content, done: item.done }, ws, peer);
      } else if ('fullText' in item) {
        sendBoth({ type: 'llm', text: item.fullText }, ws, peer);
      } else if ('audio' in item) {
        if (ttsAudioSource && RTCAudioSource) {
          // Send TTS audio via WebRTC MediaStreamTrack
          // eslint-disable-next-line no-console
          console.log('[backend] Decoding TTS audio for WebRTC playback, format:', item.format);
          try {
            const pcmBuffer = await decodeToPCM(item.audio, item.format);
            // eslint-disable-next-line no-console
            console.log('[backend] Decoded to PCM:', pcmBuffer.length, 'bytes, feeding to RTCAudioSource');

            onTTSStart?.();
            sendBoth({ type: 'tts-start' }, ws, peer);

            const completed = await feedAudioToSource(pcmBuffer, ttsAudioSource, {
              signal,
              onComplete: () => {
                sendBoth({ type: 'tts-complete' }, ws, peer);
              }
            });

            // If playback was aborted, notify and exit
            if (!completed) {
              console.log('[backend] TTS playback was interrupted');
              sendBoth({ type: 'tts-cancelled' }, ws, peer);
            }

            onTTSEnd?.();
          } catch (decodeErr) {
            // eslint-disable-next-line no-console
            console.error('[backend] Failed to decode TTS audio:', decodeErr);
            // Fallback to base64 if decode fails
            sendBoth({
              type: 'tts',
              format: item.format,
              data: item.audio.toString('base64')
            }, ws, peer);
          }
        } else {
          // Fallback to base64 if RTCAudioSource not available
          sendBoth({
            type: 'tts',
            format: item.format,
            data: item.audio.toString('base64')
          }, ws, peer);
        }
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
