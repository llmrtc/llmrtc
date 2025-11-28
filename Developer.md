# Developer Guide – @metered/LLMRTC

## What this project is
A monorepo (JS/TS) for a realtime multimodal SDK that streams voice + optional camera/screen frames to an LLM and streams TTS back over WebRTC. It includes:
- Browser client SDK (`@metered/llmrtc-web-client`)
- Node backend/signalling service (`@metered/llmrtc-backend`)
- Core contracts/orchestrator
- Provider adapters (LLM/STT/TTS/Vision) for OpenAI, ElevenLabs, Anthropic, Google, AWS Bedrock, OpenRouter, and local models
- Vite demo app

Goal: Let app devs plug in their preferred LLM/STT/TTS/vision providers, transport audio/frames over WebRTC, and get spoken responses back with minimal wiring.

## High-level flow
1. Browser connects to signalling WS, negotiates WebRTC peer connection with backend using native RTCPeerConnection.
2. Client captures mic audio and sends it over a WebRTC audio track to the backend.
3. Backend receives audio via RTCAudioSink, runs Silero VAD to detect speech boundaries. When speech ends, the audio chunk plus any pending vision attachments are processed.
4. Backend runs STT → LLM (with history + vision attachments) → TTS and streams results back:
   - Transcript/LLM chunks sent over WebRTC data channel
   - TTS audio sent over a dedicated WebRTC audio track (RTCAudioSource)
5. Client plays TTS via the received audio track, renders transcript/assistant text.

## Repository layout
- `package.json` (root): workspace config, scripts (`dev` for demo, `dev:backend` for backend), build/test/lint.
- `tsconfig.base.json` / `tsconfig.json`: shared compiler settings and project refs.
- `packages/`
  - `core/`: Types, interfaces, `ConversationOrchestrator` (manages history, runs STT→LLM→TTS, optional streaming APIs).
  - `backend/`: Node service with Express + WS signalling; uses `@roamhq/wrtc` for WebRTC; per-connection orchestrator; receives audio via RTCAudioSink, sends TTS via RTCAudioSource.
  - `web-client/`: Browser SDK. Handles signalling, native WebRTC peer connection, audio track streaming, connection state machine with reconnection support.
  - `providers/`
    - `openai/`: LLM (chat), Whisper STT, TTS adapters using OpenAI SDK.
    - `elevenlabs/`: ElevenLabs TTS adapter with WebSocket streaming.
    - `anthropic/`: Claude LLM adapter.
    - `google/`: Gemini LLM adapter.
    - `bedrock/`: AWS Bedrock LLM adapter (Claude, Llama, etc.).
    - `openrouter/`: OpenRouter LLM adapter (access to multiple models).
    - `lmstudio/`: LM Studio local LLM adapter (OpenAI-compatible).
    - `local/`: Ollama LLM, Faster-Whisper STT, Piper TTS, LLaVA vision.
- `examples/vite-demo/`: React demo app that exercises the SDK.
- `e2e/`: Playwright E2E tests with Chrome fake media support.
- `README.md`: Comprehensive user documentation with quickstart and provider configuration.
- `Developer.md`: (this doc)

## Backend (packages/backend)
- Entry: `src/index.ts`.
- Key modules:
  - `native-peer-server.ts`: Wraps RTCPeerConnection for server-side WebRTC using @roamhq/wrtc. Manages RTCAudioSink (receive audio) and RTCAudioSource (send TTS).
  - `audio-processor.ts`: Silero VAD (via avr-vad) for speech detection. Receives 48kHz PCM from RTCAudioSink, detects speech boundaries, emits speech start/end events with buffered audio.
  - `session-manager.ts`: Maintains session state for reconnection support. Sessions preserved for 30 minutes (configurable) to allow clients to reconnect and resume conversation history.
  - `mp3-decoder.ts`: Decodes MP3 TTS output to PCM for streaming via RTCAudioSource.
- Behaviour:
  - Starts HTTP server with `/health` endpoint and WS signalling.
  - On WS connection: creates per-connection `ConversationOrchestrator`, sets up NativePeerServer with RTCAudioSink/Source.
  - Audio flow: RTCAudioSink → AudioProcessor (VAD) → on speechEnd → orchestrator.runTurnStream → TTS audio → RTCAudioSource.
  - TTS barge-in: When user starts speaking during TTS playback, current TTS is cancelled immediately.
  - Heartbeat: 15s interval, 45s timeout for connection health monitoring.
- Config env vars: `OPENAI_API_KEY`, `OPENAI_BASE_URL?`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `OPENROUTER_API_KEY`, `LOCAL_ONLY=true`, `FASTER_WHISPER_URL?`, `PIPER_URL?`, `PORT`, `HOST`.
- WebRTC: Requires @roamhq/wrtc for Node.js WebRTC support. If not available, server will warn and WebRTC connections will fail.

## Core (packages/core)
- `types.ts`: Role/message types, provider interfaces (LLM/STT/TTS/Vision), session config, transport events.
- `orchestrator.ts`: ConversationOrchestrator – manages history, runs STT→LLM→TTS; streaming variant yields partials; history windowing keeps system prompt + last N turns.

## Web client SDK (packages/web-client)
- Main class: `LLMRTCWebClient`.
- Key modules:
  - `native-peer.ts`: Wraps RTCPeerConnection with a clean event-based API. Handles offer/answer negotiation, ICE gathering, data channel, and audio track management.
  - `connection-state.ts`: State machine managing connection states (disconnected, connecting, connected, reconnecting, failed, closed) with exponential backoff for reconnection.
- Key methods:
  - `start()` – connects signalling WS, establishes WebRTC peer connection; resolves when data channel is open.
  - `stop()` – gracefully closes connection and cleans up resources.
  - `shareAudio(stream)` – adds audio track to peer connection for streaming to backend. Returns `{ stop() }`.
  - `shareVideo(stream, intervalMs)` – captures frames from camera for vision; returns controller `{ stop(), getLastFrame() }`.
  - `shareScreen(stream, intervalMs)` – captures frames from screen share; similar controller.
- Events:
  - `transcript` – STT result from backend
  - `llmChunk` / `llm` – streaming and final LLM response
  - `ttsTrack` – MediaStream with TTS audio track (play directly via `<audio>` element)
  - `ttsStart` / `ttsComplete` / `ttsCancelled` – TTS playback lifecycle
  - `speechStart` / `speechEnd` – VAD events from backend
  - `stateChange` – connection state changes
  - `reconnecting` – reconnection attempt info
  - `error` – error events
- Config: `signallingUrl`, `iceServers`, `reconnection` (enabled by default with exponential backoff).
- No external WebRTC dependencies: Uses native browser RTCPeerConnection.

## Providers (packages/providers)
- `openai`: OpenAI chat (streaming), Whisper STT, TTS.
- `elevenlabs`: ElevenLabs TTS with WebSocket streaming for low latency.
- `anthropic`: Claude LLM via Anthropic SDK.
- `google`: Gemini LLM via Google Generative AI SDK.
- `bedrock`: AWS Bedrock LLM (supports Claude, Llama, Mistral, etc.).
- `openrouter`: OpenRouter LLM (unified access to OpenAI, Anthropic, Google, Meta, etc.).
- `lmstudio`: LM Studio local LLM (OpenAI-compatible API).
- `local`: Ollama LLM, Faster-Whisper STT, Piper TTS, LLaVA vision.
- Each implements the core interfaces and can be swapped in backend wiring.

## Demo app (examples/vite-demo)
- Vite + React. Connects to signalling URL, establishes WebRTC connection.
- Uses @ricky0123/vad-react for client-side VAD visualization (optional).
- Streams mic audio over WebRTC track to backend.
- Receives TTS audio via WebRTC track and plays via `<audio>` element.
- Shows transcript/assistant text, connection status.
- Configurable signal URL via UI.

## E2E Tests (e2e/)
- Playwright-based E2E test suite.
- Uses Chrome fake media flags to inject pre-recorded audio/video as mic/camera input.
- Test files:
  - `connection.spec.ts`: WebRTC connection lifecycle, state management.
  - `audio-flow.spec.ts`: Full conversation flow with speech detection, transcript, LLM response, TTS.
  - `providers/*.spec.ts`: Provider-specific tests (OpenAI, ElevenLabs, Ollama, LMStudio).
- Run: `npm run test:e2e` or `npm run test:e2e:ui` for interactive mode.
- Fixtures: `test-audio.wav` (speech with silence gaps for VAD), `test-video.y4m`.

## Running (dev)
- Backend: `npm run dev:backend` (uses ts-node ESM). Requires `@roamhq/wrtc` for WebRTC.
- Frontend demo: `npm run dev` (runs Vite demo). Open http://localhost:5173 and set signalling URL (default ws://localhost:8787).

## Building
- `npm run typecheck` (project refs build)
- `npm test` (Vitest unit tests)
- `npm run test:e2e` (Playwright E2E tests)
- `npm -w packages/backend run build` for backend dist

## Extending
- Add providers: implement relevant interface(s) from `packages/core/src/types.ts` and export from a new `packages/providers/<name>` package; wire into backend provider selection.
- Add streaming TTS/STT: extend provider interfaces (`speakStream`, `transcribeStream`) and update orchestrator to handle streaming if provided.
- Add auth: protect signalling WS with JWT; pass token in client config and validate in backend on connection.
- Persist history: implement a history store (e.g., Redis) and modify orchestrator to hydrate/persist per session id.
- Observability: add structured logging, metrics hooks around STT/LLM/TTS latencies, and connection lifecycle.

## Common issues
- Record button stays disabled / "connecting…": backend lacks wrtc; install `@roamhq/wrtc` on a compatible platform.
- No TTS playback: check ELEVENLABS_API_KEY or local Piper URL; inspect backend logs.
- Audio not detected: ensure test audio has silence gaps for VAD to detect speech boundaries.
- Connection drops: check heartbeat timeouts; client will auto-reconnect with exponential backoff.

## Architecture notes
- **Native WebRTC**: The project uses native RTCPeerConnection on both client (browser) and server (@roamhq/wrtc) for maximum control and React Native compatibility.
- **VAD in backend**: Speech detection runs server-side using Silero VAD via avr-vad package. This allows consistent behavior across all clients.
- **WebRTC audio transport**: Audio flows over WebRTC tracks (not data channel), enabling proper audio codecs and lower latency.
- **TTS streaming**: ElevenLabs TTS streams via WebSocket, decoded to PCM, and fed to RTCAudioSource for real-time playback.
- **Session persistence**: SessionManager preserves conversation state for 30 minutes, enabling reconnection without losing history.
