# Developer Guide – @metered/LLMRTC

## What this project is
A monorepo (JS/TS) for a realtime multimodal SDK that streams voice + optional camera/screen frames to an LLM and streams TTS back over WebRTC. It includes:
- Browser client SDK (`@metered/llmrtc-web-client`)
- Node backend/signalling service (`@metered/llmrtc-backend`)
- Core contracts/orchestrator
- Provider adapters (LLM/STT/TTS/Vision)
- Vite demo app

Goal: Let app devs plug in their preferred LLM/STT/TTS/vision providers, transport audio/frames over WebRTC, and get spoken responses back with minimal wiring.

## High-level flow
1. Browser connects to signalling WS, negotiates WebRTC data channel with backend.
2. Client captures mic (and optionally camera/screen frames). VAD detects speech start/stop; when user stops, the audio chunk plus latest frames are sent over the data channel.
3. Backend runs STT → LLM (with history + vision attachments) → TTS and streams results (transcript, LLM chunks, final, TTS audio) back over the same channel (mirrored to WS as well).
4. Client plays TTS, renders transcript/assistant text.

## Repository layout
- `package.json` (root): workspace config, scripts (`dev` for demo, `dev:backend` for backend), build/test/lint.
- `tsconfig.base.json` / `tsconfig.json`: shared compiler settings and project refs.
- `packages/`
  - `core/`: Types, interfaces, `ConversationOrchestrator` (manages history, runs STT→LLM→TTS, optional streaming APIs).
  - `backend/`: Node service with Express + WS signalling; uses `@roamhq/wrtc` if available; per-connection orchestrator; bridges data-channel/WS messages to providers.
  - `web-client/`: Browser SDK. Handles signalling, WebRTC data channel, VAD-based audio capture, camera/screen frame capture, event callbacks, ICE config.
  - `providers/`
    - `openai/`: LLM (chat), Whisper STT adapters using OpenAI SDK.
    - `elevenlabs/`: ElevenLabs TTS adapter.
    - `local/`: Ollama LLM, Faster-Whisper STT, Piper TTS, LLaVA vision.
- `examples/vite-demo/`: React demo app that exercises the SDK.
- `README.md`: Quickstart and user-facing notes.
- `Developer.md`: (this doc)
- `vitest.config.ts`: test runner config.

## Backend (packages/backend)
- Entry: `src/index.ts`.
- Dependencies: Express, ws, simple-peer, @roamhq/wrtc (optional), zod, uuid.
- Behaviour:
  - Starts HTTP server with `/health` and WS signalling endpoint.
  - On WS connection: creates a per-connection `ConversationOrchestrator` (so histories are isolated), sets up optional SimplePeer if WebRTC available.
  - Message types handled: `offer/signal` (SDP), `audio` (base64 audio chunk + attachments). Data-channel mirrors `audio-chunk` handling.
  - For each received audio chunk: orchestrator.runTurnStream emits transcript, LLM chunks/final, and TTS audio; server sends these back over WS and peer if connected.
  - Providers are shared singletons (for efficiency), orchestrators are per-connection (for isolation).
- Config env vars: `OPENAI_API_KEY`, `OPENAI_BASE_URL?`, `ELEVENLABS_API_KEY`, `LOCAL_ONLY=true` to switch to local providers, `FASTER_WHISPER_URL?`, `PIPER_URL?`, `PORT`, `HOST`.
- WebRTC: If @roamhq/wrtc loads, SimplePeer uses it. Otherwise, server will warn and media over WebRTC will fail (client stays “connecting…”). You can choose to add WS media fallback if desired.

## Core (packages/core)
- `types.ts`: role/message types, provider interfaces (LLM/STT/TTS/Vision), session config, transport events.
- `orchestrator.ts`: ConversationOrchestrator – manages history, runs STT→LLM→TTS; streaming variant yields partials; history windowing keeps system prompt + last N turns.

## Web client SDK (packages/web-client)
- Main class: `LLMRTCWebClient`.
- Key methods:
  - `start()` – connects signalling WS, establishes WebRTC data channel; rejects if peer can’t connect.
  - `shareAudio(stream, opts)` – VAD-based capture; on speech stop sends audio chunk + latest frames (from video/screen capture) over the data channel. Returns `{ stop() }`.
  - `shareVideo(stream, intervalMs)` – capture frames from camera; returns controller `{ stop(), getLastFrame() }`.
  - `shareScreen(stream, intervalMs)` – capture frames from screen share; similar controller.
- Events: `transcript`, `llmChunk`, `llm`, `tts`, `error`.
- Config: `signallingUrl`, `useWebRTC` (true), `iceServers` (passed to RTCPeerConnection), attachments auto-sent when VAD stops.
- Internal: simple-peer for data channel; WS only for signalling. Browser polyfills required for Buffer/stream/global; Vite demo config includes them.

## Providers (packages/providers)
- `openai`: OpenAI chat (streaming) and Whisper STT.
- `elevenlabs`: ElevenLabs TTS (non-streaming in this cut).
- `local`: Ollama LLM, Faster-Whisper STT, Piper TTS, LLaVA vision.
- Each implements the core interfaces and can be swapped in backend wiring.

## Demo app (examples/vite-demo)
- Vite + React. Connects to signalling URL, starts WebRTC client, requests mic/cam/screen. On VAD stop, sends audio + latest frames; shows transcript/assistant text; plays TTS.
- Polyfills in `index.html` and aliases in `vite.config.ts` for simple-peer.
- Status line shows connection state.

## Running (dev)
- Backend: `npm run dev:backend` (uses ts-node ESM). Requires `@roamhq/wrtc` for WebRTC; otherwise media will fail.
- Frontend demo: `npm run dev` (runs Vite demo). Open http://localhost:5173 and set signalling URL (default ws://localhost:8787).

## Building
- `npm run typecheck` (project refs build)
- `npm test` (Vitest; minimal tests today)
- `npm -w packages/backend run build` for backend dist

## Extending
- Add providers: implement relevant interface(s) from `packages/core/src/types.ts` and export from a new `packages/providers/<name>` package; wire into backend provider selection.
- Add streaming TTS/STT: extend provider interfaces (`speakStream`, `transcribeStream`) and update orchestrator to handle streaming if provided.
- Add WS media fallback: in backend, detect no wrtc and accept media over WS; in web-client add a `useWebRTC: false` path.
- Add auth: protect signalling WS with JWT; pass token in client config and validate in backend on connection.
- Persist history: implement a history store (e.g., Redis) and modify orchestrator to hydrate/persist per session id.
- Observability: add structured logging, metrics hooks around STT/LLM/TTS latencies, and connection lifecycle.

## Common issues
- Record button stays disabled / “connecting…”: backend lacks wrtc; install `@roamhq/wrtc` on a compatible platform or add WS media fallback.
- simple-peer errors about Stream/Buffer/global: ensure demo polyfills are present (already wired), restart Vite after changes.
- No TTS playback: check ELEVENLABS_API_KEY or local Piper URL; inspect backend logs.

## Suggested next steps (if you extend)
- Add JWT/CORS tightening in backend.
- Expand provider set (OpenRouter, Claude, Gemini, Bedrock, Azure/GCP STT/TTS).
- Add integration/e2e tests (wrtc loopback, Playwright demo flow).
