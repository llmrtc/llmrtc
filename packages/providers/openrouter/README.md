# @llmrtc/llmrtc-provider-openrouter

OpenRouter LLM provider for LLMRTC - access multiple models through one API.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-openrouter
```

## Usage

```typescript
import { OpenRouterLLMProvider } from '@llmrtc/llmrtc-provider-openrouter';

const llm = new OpenRouterLLMProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-3.5-sonnet'
});
```

## Features

- Access to 100+ models through one API
- Automatic fallbacks
- Cost optimization
- No per-provider API keys needed

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
