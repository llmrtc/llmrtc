---
title: Building Custom Providers
---

Implement the provider interfaces in `packages/core/src/types.ts` to integrate new models or services.

Checklist
- Implement required methods:
  - LLM: `complete(request)` and optionally `stream(request)`.
  - STT: `transcribe(audio, config?)` and optionally `transcribeStream(...)`.
  - TTS: `speak(text, config?)` and optionally `speakStream(...)`.
- Set a stable `name` for each provider (used in logs/metrics).
- Normalize responses into `LLMResult`, `STTResult`, `TTSResult`, `VisionResult` shapes.
- Handle retries/timeouts inside the provider where appropriate; surface clear, typed errors.

Mapping to provider APIs
- Map your upstream SDK’s request/response objects into the core types (`LLMRequest`, `LLMResult`, etc.).
- Translate provider tool-calling formats into `ToolCallRequest` / `ToolDefinition` when applicable.
- Convert provider-specific stop reasons into `StopReason` (`end_turn`, `tool_use`, `max_tokens`, `stop_sequence`).

Streaming
- For LLMs that support streaming, implement `stream(request)` and yield `LLMChunk` objects as tokens arrive.
- For TTS, implement `speakStream(text, config)` and yield `Buffer` chunks; the orchestrator wraps them as `TTSChunk`.
- Keep chunks small enough for responsive playback.

Tips
- Wrap HTTP clients for connection reuse and set sensible timeouts.
- Tag metrics (via `MetricsAdapter`) with provider/model names for easy comparison.
- In tests, stub HTTP calls and assert on normalized core types rather than raw provider responses.
