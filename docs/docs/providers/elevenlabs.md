---
title: ElevenLabs
---

High-quality, low-latency TTS.

Setup
```ts
import { ElevenLabsTTSProvider } from '@llmrtc/llmrtc-provider-elevenlabs';

const tts = new ElevenLabsTTSProvider({
  apiKey: process.env.ELEVENLABS_API_KEY,
  voiceId: '21m00Tcm4TlvDq8ikWAM',
  modelId: 'eleven_flash_v2_5',
  format: 'mp3'
});
```

Env vars
- `ELEVENLABS_API_KEY`

Notes
- `eleven_flash_v2_5` is optimized for latency; use `eleven_multilingual_v2` for quality.
- Supports streaming TTS; enable `streamingTTS: true` in the server.
