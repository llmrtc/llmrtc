---
title: Environment Variables
---

Provider selection
- `LLM_PROVIDER` = openai | anthropic | google | bedrock | openrouter | zai (alias: glm) | lmstudio | ollama
- `TTS_PROVIDER` = elevenlabs | openai | piper
- `STT_PROVIDER` = openai | faster-whisper | elevenlabs-scribe (aliases: elevenlabs, scribe) | openai-realtime (alias: realtime)
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
- `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GOOGLE_MODEL`, `BEDROCK_MODEL`, `OPENROUTER_MODEL`
- `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_TTS_INSTRUCTIONS`

Server config
- `PORT`, `HOST`
- `SYSTEM_PROMPT`
- `STREAMING_TTS` (true/false)
- `STREAMING_STT` (true/false, default false) - stream mic audio to STT live for interim transcripts; requires a streaming STT provider (`elevenlabs-scribe`, `openai-realtime`)

Behavior
- Auto-detection for LLM (when `LLM_PROVIDER` and `LOCAL_ONLY` are not set) picks the first provider with a valid key in this order: Anthropic → Google → Bedrock → OpenRouter → OpenAI.
- `LOCAL_ONLY=true` forces local providers: Ollama for LLM, Faster-Whisper for STT, and Piper for TTS.

## Anthropic

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_PROMPT_CACHING` | `false` | `true` places cache breakpoints on the system prompt and rolling history - cache reads cost 0.1x input price |

## OpenAI voice

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_STT_MODEL` | `whisper-1` | Transcription model; `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` improve accuracy; with `STT_PROVIDER=openai-realtime` the default is `gpt-realtime-whisper` |
| `ELEVENLABS_STT_MODEL` | `scribe_v2` | ElevenLabs Scribe batch model (`STT_PROVIDER=elevenlabs-scribe`) |
| `OPENAI_TTS_MODEL` | `tts-1` | TTS model; `gpt-4o-mini-tts` supports delivery instructions |
| `OPENAI_TTS_VOICE` | `nova` | OpenAI TTS voice: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer (plus ballad, verse on gpt-4o-mini-tts) |
| `OPENAI_TTS_INSTRUCTIONS` | - | Natural-language delivery direction (tone, pacing, persona) for instructable TTS models |

## Z.ai (GLM)

| Variable | Default | Description |
|----------|---------|-------------|
| `ZAI_API_KEY` | - | Z.ai API key (`LLM_PROVIDER=zai`) |
| `ZAI_MODEL` | `glm-5.2` | GLM model name |

## Local vision

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_VISION_MODEL` | `llava` | Vision model used by the CLI's local vision provider. The CLI default stays `llava` so existing deployments keep working; set `qwen3-vl` for the current generation (the `OllamaVisionProvider` class itself defaults to `qwen3-vl`) |
