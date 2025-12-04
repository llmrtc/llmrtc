---
title: Local - FasterWhisper
---

Local STT via FasterWhisper server.

Setup
```ts
import { FasterWhisperProvider } from '@metered/llmrtc-provider-local';

const stt = new FasterWhisperProvider({
  baseUrl: process.env.FASTER_WHISPER_URL || 'http://localhost:8000'
});
```

Env vars
- `FASTER_WHISPER_URL`

Notes
- Ensure the server runs with a compatible model; test with a short WAV before integrating.
- Lower latency than cloud STT when running on GPU locally.
