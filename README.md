# @metered/LLMRTC

Realtime JS/TS SDK for voice + LLM + vision over WebRTC/WS with pluggable providers. Monorepo includes browser client, Node backend/signalling server, provider adapters (OpenAI, ElevenLabs, Ollama/Faster-Whisper/Piper/LLaVA), and a Vite demo.

## Features (current)
- WebRTC data-channel transport (media) with WS only for signalling; demo is WebRTC-only.
- Per-client in-memory session isolation; shared provider clients for efficiency.
- Pluggable providers: OpenAI chat + Whisper, ElevenLabs TTS, Ollama LLM, Faster-Whisper STT, Piper TTS, LLaVA vision.
- Vision attachments: latest camera/screen frames can be sent with each spoken turn.
- Browser SDK API: start() (signalling+WebRTC), shareAudio() with VAD, shareVideo() and shareScreen() frame capture, events for transcript/LLM/TTS/errors, ICE servers configurable.
- Example React/Vite demo: Connect, mic+cam+screen capture, VAD-driven send, TTS playback.

## Repo layout
- `packages/core` – shared types + conversation orchestrator.
- `packages/providers/*` – adapters: `openai`, `elevenlabs`, `local` (Ollama/Faster-Whisper/Piper/LLaVA).
- `packages/backend` – Node signalling + processing service (Express + WS + optional WebRTC via `wrtc`).
- `packages/web-client` – browser SDK (`LLMRTCWebClient`, helpers, optional screen capture).
- `examples/vite-demo` – minimal React demo using the web client.

## Requirements
- Node >= 20 (tested with 22.x)
- npm (workspaces via `file:` links are already set up)
- For server-side WebRTC: optional `wrtc` native module (installs prebuilt binaries on macOS/Linux; skipped if unavailable).

## Install
```bash
npm install
npm run typecheck   # builds all TS project refs
```

## Environment variables (backend)
- `OPENAI_API_KEY` (cloud path)
- `OPENAI_BASE_URL` (optional, OpenAI-compatible)
- `ELEVENLABS_API_KEY` (cloud TTS)
- `LOCAL_ONLY`=`true` to switch to local stack
- `FASTER_WHISPER_URL` (optional, defaults http://localhost:9000)
- `PIPER_URL` (optional, defaults http://localhost:5002)
- `PORT` (defaults 8787)

## Run backend (cloud path)
```bash
OPENAI_API_KEY=sk-... ELEVENLABS_API_KEY=... npm -w packages/backend run dev
# or build + run
npm -w packages/backend run build && node packages/backend/dist/index.js
```

## Run backend (local-only demo)
```bash
LOCAL_ONLY=true npm -w packages/backend run dev
# expects local services:
# - Ollama at http://localhost:11434
# - Faster-Whisper server at http://localhost:9000
# - Piper TTS at http://localhost:5002
# - LLaVA via Ollama for vision (optional)
```

## Run the Vite demo (browser client)
```bash
npm run dev
# open http://localhost:5173
# set signalling URL (default ws://localhost:8787), connect, record/send
```
Demo is WebRTC-only for media (WS just for signalling). Ensure backend has `wrtc` or run on a machine with available prebuilds (amd64 recommended).

## Using the browser SDK (snippet)
```ts
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787',
  useWebRTC: true,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

await client.start();
client.on('transcript', console.log);
client.on('llmChunk', (c) => process.stdout.write(c));
client.on('tts', (buf) => new Audio(URL.createObjectURL(new Blob([buf]))).play());

// Mic + optional cam/screen frames attached per spoken turn
const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
const cam = await navigator.mediaDevices.getUserMedia({ video: true });
client.shareVideo(cam, 1000);
const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
client.shareScreen(screen, 1200);

await client.shareAudio(mic, { vadThreshold: 0.02, vadSilenceMs: 700, chunkMs: 400 });
```

## Transport behavior
- Media over WebRTC data channel; WS used only for signalling.
- Set `iceServers` in `LLMRTCWebClient` config to pass your TURN/STUN list.
- Each WS connection gets its own `ConversationOrchestrator` (isolated history/prompt).

## Scripts
- `npm run typecheck` – builds all TS projects
- `npm test` – vitest (passWithNoTests for now)
- `npm run lint`, `npm run format`
- `npm run dev` – starts Vite demo (convenience)

## Roadmap (short)
- Optional WS media fallback toggle for mac arm64 dev
- Auth/JWT on signalling, CORS tightening, logging
- More providers: OpenRouter, Claude, Gemini, Bedrock, Azure/GCP STT/TTS
- Persistence option (Redis) for session history when scaling horizontally

## Troubleshooting
- WebRTC errors server-side: install `wrtc` (`npm i wrtc`) or rely on WS fallback.
- Missing audio/tts: check `ELEVENLABS_API_KEY` or local Piper URL; inspect backend logs.
- Screen capture prompts: browsers require user permission; if denied, vision attachments are skipped.
