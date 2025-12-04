---
title: Library Mode
---

Embed the server in your own Node app for custom routing, auth, or metrics.

```ts
import { LLMRTCServer, AnthropicLLMProvider, FasterWhisperProvider, OpenAITTSProvider } from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new AnthropicLLMProvider({ apiKey: process.env.ANTHROPIC_API_KEY!, model: 'claude-sonnet-4-5-20250929' }),
    stt: new FasterWhisperProvider({ baseUrl: 'http://localhost:9000' }),
    tts: new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY!, voice: 'nova' })
  },
  streamingTTS: true,
  port: 3000,
  systemPrompt: 'You are a helpful assistant.'
});

server.on('listening', ({ host, port }) => console.log(`Listening on ${host}:${port}`));
server.on('connection', ({ id }) => console.log(`Client connected: ${id}`));
server.on('error', (err) => console.error(err));

await server.start();
```

You can wrap `server.start()` in your own HTTP server, add auth middleware, or mount additional REST endpoints alongside it.
