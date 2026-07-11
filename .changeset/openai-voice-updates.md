---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-provider-openai": minor
"@llmrtc/llmrtc-backend": minor
---

OpenAI voice updates: steerable TTS and current transcription models.

- TTSConfig gains an optional `instructions` field for instructable TTS
  models. OpenAITTSProvider accepts `instructions` at the constructor and
  per call, sends them for gpt-* models (e.g. gpt-4o-mini-tts), and
  ignores them with a one-time warning on tts-1/tts-1-hd.
- OpenAITTSVoice widened to the current voice roster (adds ash, ballad,
  coral, sage, verse) while accepting any string for forward
  compatibility; TTS model accepts any string. Note: code doing
  exhaustive switches over OpenAITTSVoice will need adjusting, matching
  the same widening in the official openai SDK. ballad/verse require
  gpt-4o-mini-tts; the other nine voices work on all TTS models.
- OpenAIWhisperProvider documents gpt-4o-transcribe /
  gpt-4o-mini-transcribe support.
- CLI: new OPENAI_STT_MODEL, OPENAI_TTS_MODEL, and
  OPENAI_TTS_INSTRUCTIONS environment variables.
