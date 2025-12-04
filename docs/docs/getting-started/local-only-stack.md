---
title: Local-Only Stack
---

Run everything locally (no cloud keys) using the bundled local providers.

**Providers**
- LLM: Ollama (`OllamaLLMProvider`)
- STT: FasterWhisper (`FasterWhisperProvider`)
- TTS: Piper (`PiperTTSProvider`)
- Vision: LLaVA (`LlavaVisionProvider`)

**Setup**
1) Install services:
- Ollama with a model: `ollama pull llama3.2`
- FasterWhisper server (e.g., `faster-whisper-server` on port 8000)
- Piper server (e.g., `piper-http-server` on port 5000)

2) Set env vars:
```bash
LOCAL_ONLY=true
OLLAMA_BASE_URL=http://localhost:11434
FASTER_WHISPER_URL=http://localhost:8000
PIPER_URL=http://localhost:5000
```

3) Start backend:
```bash
npx llmrtc-backend
```

4) Use the same web client; no changes required.

**When to use**
- Offline / on-prem requirements
- Prototyping without spending on tokens
- Edge devices where GPU/CPU is available
