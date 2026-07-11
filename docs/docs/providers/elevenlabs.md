---
title: ElevenLabs
---

High-quality, low-latency TTS - and Scribe speech-to-text with realtime
streaming.

## TTS

```ts
import { ElevenLabsTTSProvider } from '@llmrtc/llmrtc-provider-elevenlabs';

const tts = new ElevenLabsTTSProvider({
  apiKey: process.env.ELEVENLABS_API_KEY,
  voiceId: '21m00Tcm4TlvDq8ikWAM',
  modelId: 'eleven_flash_v2_5',
  format: 'mp3'
});
```

## STT (Scribe)

`ElevenLabsScribeProvider` covers both transcription modes:

- **Batch** - `transcribe()` posts the utterance to the Scribe v2 API
  (high accuracy, 90+ languages).
- **Realtime streaming** - `transcribeStream()` connects to the Scribe v2
  Realtime WebSocket and yields partial transcripts with sub-150ms
  latency while the user is still speaking, then a committed final.

```ts
import { ElevenLabsScribeProvider } from '@llmrtc/llmrtc-provider-elevenlabs';

const stt = new ElevenLabsScribeProvider({
  apiKey: process.env.ELEVENLABS_API_KEY,
  languageCode: 'en' // optional; auto-detects when omitted
});
```

Pair it with `streamingSTT: true` on the server for live interim
transcripts - see [Streaming Speech-to-Text](../backend/streaming-stt).

CLI mode:

```bash
STT_PROVIDER=elevenlabs-scribe
STREAMING_STT=true                # optional: live interim transcripts
ELEVENLABS_STT_MODEL=scribe_v2    # optional batch-model override
```

Env vars
- `ELEVENLABS_API_KEY`
- Optional: `ELEVENLABS_STT_MODEL`

Notes
- TTS: `eleven_flash_v2_5` is optimized for latency; use `eleven_multilingual_v2` for quality, or `eleven_v3` for the most expressive delivery.
- Supports streaming TTS; enable `streamingTTS: true` in the server.
