---
title: Environment Variables
---

Provider selection
- `LLM_PROVIDER` = openai | anthropic | google | bedrock | openrouter | lmstudio | ollama (default)
- `TTS_PROVIDER` = elevenlabs | openai | piper
- `STT_PROVIDER` = openai | faster-whisper
- `LOCAL_ONLY` = true to force local providers

API keys / URLs
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- `ELEVENLABS_API_KEY`
- `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, `FASTER_WHISPER_URL`, `PIPER_URL`

Model overrides
- `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GOOGLE_MODEL`, `BEDROCK_MODEL`, `OPENROUTER_MODEL`, `OPENAI_TTS_VOICE`

Server config
- `PORT`, `HOST`
- `SYSTEM_PROMPT`
- `STREAMING_TTS` (true/false)

Behavior
- Auto-detection for LLM (when `LLM_PROVIDER` and `LOCAL_ONLY` are not set) picks the first provider with a valid key in this order: Anthropic → Google → Bedrock → OpenRouter → OpenAI.
- `LOCAL_ONLY=true` forces local providers: Ollama for LLM, Faster-Whisper for STT, and Piper for TTS.
