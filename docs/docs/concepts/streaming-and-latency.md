---
title: Streaming & Latency
---

Low latency is the point of LLMRTC. Optimize each hop.

- **STT streaming**: send audio continuously; show partial transcripts; finalize on `isFinal`.
- **LLM streaming**: use `stream: true` to emit `llmChunk`; start TTS as soon as content is stable.
- **TTS streaming**: enable `streamingTTS: true` to get audio chunks or a WebRTC audio track; requires FFmpeg.
- **Network**: keep signalling + media servers close to users; enable ICE/TURN where needed.
- **Tokens**: cap `maxTokens` and `historyLimit` to reduce model latency.

Fine-tuning TTS chunking
- Override `sentenceChunker` in server config to split output for languages/punctuation that don’t use periods (helps smooth streaming playback).

Targets
- Under 300 ms time-to-first-transcript after speech end
- Under 700 ms time-to-first-TTS for natural barge-in UX
