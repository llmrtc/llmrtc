---
title: OpenAI
---

Supported
- LLM: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, streaming + vision
- STT: Whisper (`whisper-1`)
- TTS: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, streaming

Setup
```ts
import { OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@llmrtc/llmrtc-provider-openai';

const llm = new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini' });
const stt = new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'whisper-1' });
const tts = new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'tts-1', voice: 'nova' });
```

Env vars
- `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_BASE_URL`

Notes
- Vision is supported via message attachments.
- Use `gpt-4o-mini` for latency-sensitive or cost-sensitive flows.
