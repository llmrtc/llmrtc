---
title: Backend Quickstart
---

Minimal server using OpenAI LLM + Whisper STT + ElevenLabs TTS. Uses streaming TTS for low latency.

```ts
import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider
} from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new ElevenLabsTTSProvider({ apiKey: process.env.ELEVENLABS_API_KEY! })
  },
  streamingTTS: true,
  port: 8787,
  systemPrompt: 'You are a helpful voice assistant.'
});

server.on('connection', ({ id }) => console.log(`Client connected: ${id}`));
await server.start();
```

**Run it**
```bash
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=xi-...
node server.js        # or ts-node server.ts
```

Health check: `http://localhost:8787/health`

**Next steps**
- Add CORS/host/port overrides in `LLMRTCServer` options.
- Switch providers via env vars (see Backend › Environment Variables).
