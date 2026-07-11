---
title: OpenAI
---

Supported
- LLM: `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano` (streaming + vision)
- STT: `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`
- TTS: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` (instructable), streaming

Setup
```ts
import { OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@llmrtc/llmrtc-provider-openai';

const llm = new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5.2' });
const stt = new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o-mini-transcribe' });
const tts = new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY, model: 'tts-1', voice: 'nova' });
```

## Speech-to-text models

`OpenAIWhisperProvider` runs on OpenAI's transcription endpoint and accepts
any transcription model:

| Model | Notes |
|-------|-------|
| `whisper-1` | Default. Battle-tested, widest language coverage |
| `gpt-4o-transcribe` | Higher accuracy, better with noisy audio and accents |
| `gpt-4o-mini-transcribe` | Near-`gpt-4o-transcribe` accuracy at lower cost - a good default for voice agents |
| `gpt-realtime-whisper` | Native streaming over the Realtime API - use `OpenAIRealtimeSTTProvider` (below) |

```ts
const stt = new OpenAIWhisperProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini-transcribe',
  language: 'en' // optional hint
});
```

### Streaming transcription (Realtime API)

`OpenAIRealtimeSTTProvider` streams audio to a transcription-type
Realtime session and yields interim transcripts while the user is still
speaking. Billing follows the transcription model's audio-duration
pricing, not realtime LLM tokens.

```ts
import { OpenAIRealtimeSTTProvider } from '@llmrtc/llmrtc-provider-openai';

const stt = new OpenAIRealtimeSTTProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-realtime-whisper',  // default
  delay: 'low'                    // optional latency/accuracy trade-off
});
```

Enable `streamingSTT: true` on the server (or `STREAMING_STT=true` +
`STT_PROVIDER=openai-realtime` in CLI mode) for live interim
transcripts - see [Streaming Speech-to-Text](../backend/streaming-stt).

## Text-to-speech

Available voices: `alloy`, `ash`, `coral`, `echo`, `fable`, `nova`,
`onyx`, `sage`, `shimmer` on all models; `ballad` and `verse`
additionally on `gpt-4o-mini-tts`.

### Steerable delivery with `gpt-4o-mini-tts`

The `gpt-4o-mini-tts` model accepts natural-language **instructions** that
control tone, pacing, emotion, and accent - useful for giving your voice
agent a consistent persona:

```ts
const tts = new OpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini-tts',
  voice: 'coral',
  instructions: 'Speak like a friendly, upbeat concierge. Keep a brisk pace.'
});
```

Instructions can also be set per call:

```ts
await tts.speak('I found three options for you.', {
  instructions: 'Sound pleased, as if delivering good news.'
});
```

Instructions are only sent when the model name starts with `gpt-`. On any
other name - `tts-1`, `tts-1-hd`, or a proxy/deployment alias - they are
ignored with a one-time warning, because the API rejects them there. If you
run an instructable model behind an alias, name it with a `gpt-` prefix or
pass the real model name per call.

Env vars
- `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_TTS_INSTRUCTIONS`, `OPENAI_BASE_URL`

Notes
- Vision is supported via message attachments.
- Use `gpt-5-mini` for latency-sensitive or cost-sensitive flows.
- For the lowest TTS latency, use `format: 'pcm'` with `speakStream` (24kHz, 16-bit signed LE, mono).
