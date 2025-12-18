---
title: Anthropic
---

Supported
- LLM: `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5` (vision capable)
- Streaming supported

Setup
```ts
import { AnthropicLLMProvider } from '@llmrtc/llmrtc-provider-anthropic';

const llm = new AnthropicLLMProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-5'
});
```

Env vars
- `ANTHROPIC_API_KEY`
- Optional: `ANTHROPIC_MODEL`

Notes
- Great for tool use and longer context windows; latency slightly higher than OpenAI mini models.
