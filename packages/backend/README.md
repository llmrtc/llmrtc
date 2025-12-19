# @llmrtc/llmrtc-backend

Node.js backend server for LLMRTC - real-time voice and vision AI with WebRTC + LLMs.

## Installation

```bash
npm install @llmrtc/llmrtc-backend
```

## Features

- WebRTC signaling and media server
- Real-time audio/video streaming
- Voice activity detection with barge-in support
- Provider-agnostic LLM/STT/TTS integration
- Multi-stage playbook orchestration
- Tool calling and function execution

## Quick Start

```typescript
import { LLMRTCServer, OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY! })
  },
  port: 8787
});

await server.start();
```

## CLI

```bash
npx llmrtc-backend --port 8787
```

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
