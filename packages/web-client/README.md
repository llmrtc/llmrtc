# @llmrtc/llmrtc-web-client

Browser SDK for LLMRTC - real-time voice and vision AI with WebRTC + LLMs.

## Installation

```bash
npm install @llmrtc/llmrtc-web-client
```

## Features

- WebRTC client for connecting to LLMRTC backend
- Microphone and camera capture
- Screen sharing support
- Event-driven API for transcripts, LLM responses, and audio
- Connection state management with auto-reconnect

## Quick Start

```typescript
import { LLMRTCWebClient } from '@llmrtc/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787'
});

client.on('transcript', (text) => console.log('You said:', text));
client.on('llm', (response) => console.log('AI:', response));

await client.start();

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
await client.shareAudio(stream);
```

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
