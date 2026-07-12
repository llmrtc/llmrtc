---
title: Google Gemini
---

Supported
- LLM: Gemini 3.5 Flash (current recommended), 3.1 Flash Lite, 2.5 Flash/Pro; multimodal
- Realtime speech-to-speech: `gemini-3.1-flash-live-preview` via the Gemini Live API (experimental relay mode)
- Streaming supported

Setup
```ts
import { GeminiLLMProvider } from '@llmrtc/llmrtc-provider-google';

const llm = new GeminiLLMProvider({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-3.5-flash' // current recommended; provider default is gemini-2.5-flash
});
```

Env vars
- `GOOGLE_API_KEY`
- Optional: `GOOGLE_MODEL`

Notes
- Strong on vision tasks; Flash is cost-effective for real-time voice.

## Realtime speech-to-speech (experimental)

`GeminiLiveSpeechProvider` connects sessions to the Gemini Live API for
native voice-to-voice conversations, used with the server's
[realtime relay mode](../backend/realtime-speech). The adapter handles
Gemini's ~10-minute socket lifetimes internally (session resumption
with input buffering, so reconnects don't clip user speech):

```ts
import { GeminiLiveSpeechProvider } from '@llmrtc/llmrtc-provider-google';

const provider = new GeminiLiveSpeechProvider({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-3.1-flash-live-preview' // default
});
```

Note: the Gemini Live API is a Google preview; this adapter is
experimental and conformance-tested against the documented wire format.
