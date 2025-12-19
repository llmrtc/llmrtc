# @llmrtc/llmrtc-provider-anthropic

Anthropic Claude LLM provider for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-anthropic
```

## Usage

```typescript
import { AnthropicLLMProvider } from '@llmrtc/llmrtc-provider-anthropic';

const llm = new AnthropicLLMProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-20250514'
});
```

## Supported Models

- claude-sonnet-4-20250514
- claude-opus-4-20250514
- claude-3-5-sonnet-20241022
- And other Claude models

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
