---
title: Local - Piper
---

Local TTS via Piper server.

Setup
```ts
import { PiperTTSProvider } from '@metered/llmrtc-provider-local';

const tts = new PiperTTSProvider({
  baseUrl: process.env.PIPER_URL || 'http://localhost:5000'
});
```

Env vars
- `PIPER_URL`

Notes
- Choose a fast Piper voice for realtime use.
- Works well with streaming TTS enabled in the server.
