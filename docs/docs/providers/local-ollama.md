---
title: Local - Ollama
---

Run LLMs locally via Ollama.

Setup
```ts
import { OllamaLLMProvider } from '@metered/llmrtc-provider-local';

const llm = new OllamaLLMProvider({
  model: 'llama3.2',
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
});
```

Env vars
- `OLLAMA_BASE_URL`
- Optional: `OLLAMA_MODEL`

Notes
- Pull the model first: `ollama pull llama3.2`.
- Good for offline/edge; expect higher latency on CPU-only machines.
