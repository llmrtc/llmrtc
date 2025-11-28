import { config } from 'dotenv';
import { resolve } from 'path';
// Load .env from root directory (npm scripts run from workspace root)
config({ path: resolve(process.cwd(), '.env') });

import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import {
  ConversationOrchestrator,
  VisionAttachment,
  ConversationProviders
} from '@metered/llmrtc-core';
import { AudioProcessor } from './audio-processor.js';
import { decodeToPCM, feedAudioToSource } from './mp3-decoder.js';
import { NativePeerServer, AudioData } from './native-peer-server.js';
import { SessionManager } from './session-manager.js';
import {
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  OpenAITTSProvider
} from '@metered/llmrtc-provider-openai';
import { ElevenLabsTTSProvider } from '@metered/llmrtc-provider-elevenlabs';
import {
  LlavaVisionProvider,
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@metered/llmrtc-provider-local';
import { AnthropicLLMProvider } from '@metered/llmrtc-provider-anthropic';
import { GeminiLLMProvider } from '@metered/llmrtc-provider-google';
import { BedrockLLMProvider } from '@metered/llmrtc-provider-bedrock';
import { OpenRouterLLMProvider } from '@metered/llmrtc-provider-openrouter';
import { LMStudioLLMProvider } from '@metered/llmrtc-provider-lmstudio';
import type { LLMProvider, STTProvider, TTSProvider } from '@metered/llmrtc-core';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const HOST = process.env.HOST ?? '127.0.0.1';

const HEARTBEAT_TIMEOUT_MS = 45000; // 45 seconds (3 missed heartbeats)

// =============================================================================
// Provider Selection
// =============================================================================

/**
 * LLM Provider selection priority:
 * 1. LLM_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → ollama
 * 3. Auto-detect based on available API keys
 */
function createLLMProvider(): LLMProvider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();

  if (explicit) {
    switch (explicit) {
      case 'anthropic':
        return new AnthropicLLMProvider({
          apiKey: process.env.ANTHROPIC_API_KEY ?? '',
          model: process.env.ANTHROPIC_MODEL
        });
      case 'google':
      case 'gemini':
        return new GeminiLLMProvider({
          apiKey: process.env.GOOGLE_API_KEY ?? '',
          model: process.env.GOOGLE_MODEL
        });
      case 'bedrock':
        return new BedrockLLMProvider({
          region: process.env.AWS_REGION ?? 'us-east-1',
          credentials: process.env.AWS_ACCESS_KEY_ID ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? ''
          } : undefined,
          model: process.env.BEDROCK_MODEL
        });
      case 'openrouter':
        return new OpenRouterLLMProvider({
          apiKey: process.env.OPENROUTER_API_KEY ?? '',
          model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet'
        });
      case 'lmstudio':
        return new LMStudioLLMProvider({
          baseUrl: process.env.LMSTUDIO_BASE_URL,
          model: process.env.LMSTUDIO_MODEL
        });
      case 'ollama':
        return new OllamaLLMProvider({
          baseUrl: process.env.OLLAMA_BASE_URL,
          model: process.env.OLLAMA_MODEL
        });
      case 'openai':
      default:
        return new OpenAILLMProvider({
          apiKey: process.env.OPENAI_API_KEY ?? '',
          baseURL: process.env.OPENAI_BASE_URL,
          model: process.env.OPENAI_MODEL
        });
    }
  }

  // LOCAL_ONLY mode
  if (process.env.LOCAL_ONLY === 'true') {
    return new OllamaLLMProvider({
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL
    });
  }

  // Auto-detect based on available API keys
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL
    });
  }
  if (process.env.GOOGLE_API_KEY) {
    return new GeminiLLMProvider({
      apiKey: process.env.GOOGLE_API_KEY,
      model: process.env.GOOGLE_MODEL
    });
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return new BedrockLLMProvider({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      },
      model: process.env.BEDROCK_MODEL
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    return new OpenRouterLLMProvider({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3.5-sonnet'
    });
  }

  // Default to OpenAI
  return new OpenAILLMProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL
  });
}

/**
 * STT Provider selection priority:
 * 1. STT_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → faster-whisper
 * 3. Default to OpenAI Whisper
 */
function createSTTProvider(): STTProvider {
  const explicit = process.env.STT_PROVIDER?.toLowerCase();

  if (explicit === 'faster-whisper' || explicit === 'fasterwhisper') {
    return new FasterWhisperProvider({
      baseUrl: process.env.FASTER_WHISPER_URL
    });
  }

  if (process.env.LOCAL_ONLY === 'true') {
    return new FasterWhisperProvider({
      baseUrl: process.env.FASTER_WHISPER_URL
    });
  }

  return new OpenAIWhisperProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL
  });
}

/**
 * TTS Provider selection priority:
 * 1. TTS_PROVIDER env var (explicit selection)
 * 2. LOCAL_ONLY=true → piper
 * 3. Auto-detect based on available API keys
 */
function createTTSProvider(): TTSProvider {
  const explicit = process.env.TTS_PROVIDER?.toLowerCase();

  if (explicit) {
    switch (explicit) {
      case 'openai':
        return new OpenAITTSProvider({
          apiKey: process.env.OPENAI_API_KEY ?? '',
          baseURL: process.env.OPENAI_BASE_URL,
          voice: (process.env.OPENAI_TTS_VOICE as any) ?? 'nova'
        });
      case 'piper':
        return new PiperTTSProvider({
          baseUrl: process.env.PIPER_URL
        });
      case 'elevenlabs':
      default:
        return new ElevenLabsTTSProvider({
          apiKey: process.env.ELEVENLABS_API_KEY ?? ''
        });
    }
  }

  if (process.env.LOCAL_ONLY === 'true') {
    return new PiperTTSProvider({
      baseUrl: process.env.PIPER_URL
    });
  }

  // Auto-detect: prefer ElevenLabs if key is set, otherwise OpenAI
  if (process.env.ELEVENLABS_API_KEY) {
    return new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY
    });
  }

  // Fall back to OpenAI TTS if no ElevenLabs key
  return new OpenAITTSProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    baseURL: process.env.OPENAI_BASE_URL,
    voice: (process.env.OPENAI_TTS_VOICE as any) ?? 'nova'
  });
}

// =============================================================================
// Initialize Providers
// =============================================================================

const llmProvider = createLLMProvider();
const sttProvider = createSTTProvider();
const ttsProvider = createTTSProvider();
const visionProvider = process.env.LOCAL_ONLY === 'true' ? new LlavaVisionProvider({}) : undefined;

// Log selected providers
console.log('='.repeat(60));
console.log('[backend] Provider Configuration:');
console.log(`  LLM: ${llmProvider.name}`);
console.log(`  STT: ${sttProvider.name}`);
console.log(`  TTS: ${ttsProvider.name}`);
console.log(`  Vision: ${visionProvider?.name ?? 'disabled'}`);
console.log('='.repeat(60));

let wrtcLib: any = null;
let RTCAudioSource: any = null;
try {
  const mod = await import('@roamhq/wrtc');
  wrtcLib = (mod as any).default ?? mod;
  // Get nonstandard APIs for audio sink/source
  RTCAudioSource = wrtcLib.nonstandard?.RTCAudioSource;
  console.log('[backend] wrtc loaded (@roamhq/wrtc), WebRTC enabled');
  console.log('[backend] RTCAudioSource available:', !!RTCAudioSource);
} catch (err) {
  console.warn('[backend] wrtc not available, WebRTC connections will fail');
}

const app = express();
app.use(cors());
app.get('/health', (_req: express.Request, res: express.Response) =>
  res.json({ ok: true })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const sharedProviders: ConversationProviders = {
  llm: llmProvider,
  stt: sttProvider,
  tts: ttsProvider,
  vision: visionProvider
};

// Initialize shared provider clients once
Promise.all([
  sharedProviders.llm.init?.(),
  sharedProviders.stt.init?.(),
  sharedProviders.tts.init?.(),
  sharedProviders.vision?.init?.()
]).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[startup] failed to init providers', err);
});

// Session manager for reconnection support
const sessionManager = new SessionManager();

wss.on('connection', (ws) => {
  const connId = uuidv4();
  console.log(`[backend] New connection: ${connId}`);

  // Create initial session
  let session = sessionManager.createSession(
    connId,
    new ConversationOrchestrator({
      systemPrompt: 'You are a helpful realtime voice assistant.',
      historyLimit: 8,
      providers: sharedProviders
    })
  );

  let peer: NativePeerServer | null = null;
  let audioProcessor: AudioProcessor | null = null;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingAttachments: VisionAttachment[] = [];

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

  // Send ready message with session ID
  ws.send(JSON.stringify({ type: 'ready', id: connId }));

  const resetHeartbeatTimeout = () => {
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
      console.log(`[backend] Client ${connId} heartbeat timeout`);
      ws.close();
    }, HEARTBEAT_TIMEOUT_MS);
  };

  resetHeartbeatTimeout();

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: msg.timestamp }));
          resetHeartbeatTimeout();
          sessionManager.touchSession(session.id);
          break;

        case 'reconnect': {
          // Try to recover existing session
          const existingSession = sessionManager.getSession(msg.sessionId);
          if (existingSession) {
            session = existingSession;
            console.log(`[backend] Session recovered: ${msg.sessionId}`);
            ws.send(
              JSON.stringify({
                type: 'reconnect-ack',
                success: true,
                sessionId: msg.sessionId,
                historyRecovered: true
              })
            );
          } else {
            // Create new session with the provided ID
            session = sessionManager.createSession(
              msg.sessionId || connId,
              new ConversationOrchestrator({
                systemPrompt: 'You are a helpful realtime voice assistant.',
                historyLimit: 8,
                providers: sharedProviders
              })
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
          console.log('[backend] Received', msg.type);

          if (!peer || peer.destroyed) {
            // Create new peer and audio processor
            peer = createPeer(ws);
            if (peer) {
              audioProcessor = new AudioProcessor();
              setupPeerHandlers(peer, audioProcessor, ws, session.orchestrator);
            }
          }

          if (peer && msg.signal) {
            const answer = await peer.handleOffer(msg.signal);
            ws.send(JSON.stringify({ type: 'signal', signal: answer }));
          }
          break;

        case 'audio':
          // Legacy base64 audio handling (fallback)
          console.log('[backend] Received audio message, size:', msg.data?.length, 'bytes');
          const audioBuf = Buffer.from(msg.data, 'base64');
          const attachments: VisionAttachment[] = msg.attachments ?? [];
          await handleAudio(
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
      // eslint-disable-next-line no-console
      console.error('ws message error', err);
    }
  });

  ws.on('close', () => {
    console.log(`[backend] Connection closed: ${connId}`);
    if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    cancelCurrentTTS();
    peer?.destroy();
    audioProcessor?.destroy();
    // Don't remove session immediately - allow reconnection via SessionManager TTL
  });

  ws.on('error', (err) => {
    console.error(`[backend] WebSocket error for ${connId}:`, err);
  });

  // Setup handlers for the peer - needs access to connection-scoped variables
  function setupPeerHandlers(
    peer: NativePeerServer,
    audioProcessor: AudioProcessor,
    ws: WebSocket,
    orchestrator: ConversationOrchestrator
  ) {
    peer.on('connect', () => {
      console.log('[backend] WebRTC peer connected');
    });

    peer.on('close', () => {
      console.log('[backend] WebRTC peer closed');
      audioProcessor.destroy();
    });

    peer.on('error', (err) => {
      console.error('[backend] Peer error:', err);
      audioProcessor.destroy();
    });

    peer.on('track', async (track: MediaStreamTrack, stream: MediaStream) => {
      console.log('[backend] Received track:', track.kind);

      if (track.kind === 'audio') {
        try {
          await audioProcessor.initVAD();
        } catch (err) {
          console.error('[backend] Failed to initialize VAD:', err);
        }

        // Set up VAD event handlers
        audioProcessor.on('speechStart', () => {
          console.log('[backend] VAD detected speech start');
          if (isTTSPlaying) {
            console.log('[backend] User interrupted TTS - cancelling playback');
            cancelCurrentTTS();
            sendBoth({ type: 'tts-cancelled' }, ws, peer);
          }
          sendBoth({ type: 'speech-start' }, ws, peer);
        });

        audioProcessor.on('speechEnd', async (pcmBuffer: Buffer) => {
          console.log(
            '[backend] VAD detected speech end, processing',
            pcmBuffer.length,
            'bytes'
          );
          sendBoth({ type: 'speech-end' }, ws, peer);

          if (pcmBuffer.length > 0) {
            // Cancel any previous response generation
            cancelCurrentTTS();

            // Create new abort controller for this turn
            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;

            // Convert PCM to WAV for STT providers
            const wavBuffer = audioProcessor.pcmToWav(pcmBuffer);
            console.log('[backend] PCM to WAV conversion complete:', wavBuffer.length, 'bytes');

            await handleAudio(orchestrator, wavBuffer, ws, peer, pendingAttachments, peer.ttsAudioSource, {
              signal,
              onTTSStart: () => {
                isTTSPlaying = true;
              },
              onTTSEnd: () => {
                isTTSPlaying = false;
                currentAbortController = null;
              }
            });
            pendingAttachments = [];
          }
        });
      }
    });

    // Handle audio data from RTCAudioSink
    peer.on('audioData', async (data: AudioData) => {
      await audioProcessor.processPCMData(data);
    });

    peer.on('data', async (data: string) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.type) {
          case 'attachments':
            pendingAttachments = msg.attachments ?? [];
            console.log('[backend] Received attachments:', pendingAttachments.length);
            break;

          default:
            console.log('[backend] Unknown data channel message:', msg.type);
        }
      } catch (err) {
        console.error('[backend] peer data error', err);
      }
    });
  }
});

function createPeer(ws: WebSocket): NativePeerServer | null {
  if (!wrtcLib) {
    ws.send(JSON.stringify({ type: 'error', message: 'WebRTC not available on server' }));
    return null;
  }

  console.log('[backend] Creating NativePeerServer with wrtcLib.nonstandard:', wrtcLib.nonstandard ? 'exists' : 'undefined');
  console.log('[backend] wrtcLib.nonstandard.RTCAudioSource:', wrtcLib.nonstandard?.RTCAudioSource ? 'exists' : 'undefined');

  const peer = new NativePeerServer({
    wrtcLib,
    iceServers: []
  });

  console.log('[backend] Created NativePeerServer');

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
  peer: NativePeerServer | null,
  attachments: VisionAttachment[],
  ttsAudioSource?: any,
  options?: HandleAudioOptions
) {
  const { signal, onTTSStart, onTTSEnd } = options ?? {};

  console.log('[backend] handleAudio - processing', audio.length, 'bytes');
  try {
    for await (const item of orchestrator.runTurnStream(audio, attachments)) {
      // Check if cancelled before processing each item
      if (signal?.aborted) {
        console.log('[backend] Response generation cancelled by user interruption');
        break;
      }

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
          console.log('[backend] Decoding TTS audio for WebRTC playback, format:', item.format);
          try {
            const pcmBuffer = await decodeToPCM(item.audio, item.format);
            console.log(
              '[backend] Decoded to PCM:',
              pcmBuffer.length,
              'bytes, feeding to RTCAudioSource'
            );

            onTTSStart?.();
            sendBoth({ type: 'tts-start' }, ws, peer);

            const completed = await feedAudioToSource(pcmBuffer, ttsAudioSource, {
              signal,
              onComplete: () => {
                sendBoth({ type: 'tts-complete' }, ws, peer);
              }
            });

            // If playback was aborted, notify
            if (!completed) {
              console.log('[backend] TTS playback was interrupted');
              sendBoth({ type: 'tts-cancelled' }, ws, peer);
            }

            onTTSEnd?.();
          } catch (decodeErr) {
            console.error('[backend] Failed to decode TTS audio:', decodeErr);
            // Fallback to base64 if decode fails
            sendBoth(
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
          // Fallback to base64 if RTCAudioSource not available
          sendBoth(
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
    console.error('[backend] handleAudio error', err);
    sendBoth({ type: 'error', message: (err as Error).message }, ws, peer);
  }
}

function sendBoth(payload: unknown, ws: WebSocket, peer: NativePeerServer | null) {
  const data = JSON.stringify(payload);
  if (ws.readyState === ws.OPEN) ws.send(data);
  if (peer?.connected) peer.send(data);
}

server.listen(PORT, HOST, () => {
  console.log(`@metered/LLMRTC backend listening on ${HOST}:${PORT}`);
});
