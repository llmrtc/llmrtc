---
title: OpenRouter
---

Multi-model gateway across providers with one API key.

Setup
```ts
import { OpenRouterLLMProvider } from '@llmrtc/llmrtc-provider-openrouter';

const llm = new OpenRouterLLMProvider({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'anthropic/claude-sonnet-4.5',
  siteUrl: 'https://myapp.com',
  siteName: 'My App'
});
```

Env vars
- `OPENROUTER_API_KEY`
- Optional: `OPENROUTER_MODEL`

Notes
- Model string uses `provider/model` format.
- Good for experimenting with many models; pay attention to per-model latency and rate limits.
