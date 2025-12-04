---
title: Local-only Assistant
---

Based on `examples/local-only` and `examples/local-assistant`.

Stack
- Ollama (LLM)
- FasterWhisper (STT)
- Piper (TTS)
- Optional LLaVA (vision)

Run
```bash
LOCAL_ONLY=true \
OLLAMA_BASE_URL=http://localhost:11434 \
FASTER_WHISPER_URL=http://localhost:8000 \
PIPER_URL=http://localhost:5000 \
npm run dev
```

Use this when you need offline/air-gapped deployments.
