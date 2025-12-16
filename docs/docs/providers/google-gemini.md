---
title: Google Gemini
---

Supported
- LLM: Gemini 2.5 Flash (fast) and Pro (quality); multimodal
- Streaming supported

Setup
```ts
import { GeminiLLMProvider } from '@llmrtc/llmrtc-provider-google';

const llm = new GeminiLLMProvider({
  apiKey: process.env.GOOGLE_API_KEY,
  model: 'gemini-2.5-flash'
});
```

Env vars
- `GOOGLE_API_KEY`
- Optional: `GOOGLE_MODEL`

Notes
- Strong on vision tasks; Flash is cost-effective for real-time voice.
