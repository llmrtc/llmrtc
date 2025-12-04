---
title: LMStudio
---

Use LMStudio as a local LLM inference server.

Setup
```ts
import { LMStudioLLMProvider } from '@metered/llmrtc-provider-lmstudio';

const llm = new LMStudioLLMProvider({
  baseUrl: 'http://localhost:1234/v1',
  model: 'llama-3.2-3b'
});
```

Env vars
- `LMSTUDIO_BASE_URL`
- Optional: `LMSTUDIO_MODEL`

Notes
- Great for prototyping and edge use cases; ensure the model is loaded in LMStudio before starting the backend.
