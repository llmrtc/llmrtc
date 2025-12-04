---
title: Web Client Quickstart
---

Connect a browser to the backend and stream microphone audio over WebRTC.

```ts
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787',
  iceServers: []
});

client.on('transcript', (text) => console.log('You said:', text));
client.on('llmChunk', (chunk) => console.log('AI:', chunk));
client.on('ttsTrack', (stream) => {
  const audio = new Audio();
  audio.srcObject = stream;
  audio.play();
});

await client.start();
const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
await client.shareAudio(mic);
```

**UI hints**
- Display connection state (`stateChange`), listening/speaking indicators, and current transcript.
- Handle `ttsCancelled` to stop playback when the user barges in.

**Host it**
Run via Vite/Next. For local dev ensure the page is served over HTTP(S) and the websocket URL matches your backend.
