---
title: Conversation Orchestrator
---

The orchestrator runs the turn loop: audio → STT → LLM → TTS, with streaming support.

Key APIs
- `runTurn(audio, attachments?)`: one-shot turn, returns final transcript + LLM result + TTS.
- `runTurnStream(audio, attachments?)`: async iterator yielding `STTResult`, `LLMChunk`, `LLMResult`, `TTSResult` as they happen.
- Config: `systemPrompt`, `historyLimit`, `temperature`, `topP`, `maxTokens`, provider instances.

When to use
- Library mode inside your own backend service.
- Testing custom providers or playbooks without the full server.

Tips
- Prefer `runTurnStream` for latency-sensitive UX; render partial transcripts and LLM chunks.
- Use `toolChoice` and `tools` on requests to drive tool calling.
