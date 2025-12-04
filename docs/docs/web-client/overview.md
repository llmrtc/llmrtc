---
title: Web Client Overview
---

`@metered/llmrtc-web-client` handles WebRTC signaling, audio/video capture, and event emission in the browser.

Highlights
- WebSocket signaling + WebRTC data channel
- Auto reconnection with session recovery
- Audio + optional video/screen capture helpers
- Event-driven API for transcripts, LLM chunks, TTS playback, state

Use it in any modern frontend (Vite, Next.js, plain JS).

Key pieces (see `packages/web-client/src/index.ts`)
- `LLMRTCWebClient` – main class; handles WS + WebRTC + events.
- `ConnectionState` – `disconnected`, `connecting`, `connected`, `reconnecting`, `failed`.
- Events: `transcript`, `llm`, `llmChunk`, `ttsTrack`, `ttsStart`, `ttsComplete`, `speechStart`, `speechEnd`, `toolCallStart`, `toolCallEnd`, `stageChange`, `error`, `stateChange`, `reconnecting`.

See also:
- Web Client → Installation, Connection Lifecycle, Audio, Video & Vision, Events, UI Patterns.
- Concepts → Audio, VAD & Barge-in; Concepts → Vision & Attachments.
