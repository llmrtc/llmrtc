---
title: Providers Abstraction
---

Providers wrap external or local services for LLM, STT, TTS, and Vision. The orchestrator talks to providers via small interfaces so you can swap them without changing app code.

Interfaces (simplified)
- `LLMProvider.complete` / `stream`
- `STTProvider.transcribe` / `transcribeStream`
- `TTSProvider.speak` / `speakStream`
- `VisionProvider.analyze` (optional)

Capabilities
- Cloud: OpenAI, Anthropic, Gemini, Bedrock, OpenRouter
- Local: Ollama, FasterWhisper, Piper, LLaVA

Tips
- Keep provider instances long-lived (they cache auth/HTTP clients).
- For multi-provider routing, create multiple provider instances and pick per request.
- Use env vars to select providers at runtime (see Backend › Environment Variables).
