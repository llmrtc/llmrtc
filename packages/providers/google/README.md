# @llmrtc/llmrtc-provider-google

Google Gemini LLM provider for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-google
```

## Usage

```typescript
import { GeminiLLMProvider } from '@llmrtc/llmrtc-provider-google';

const llm = new GeminiLLMProvider({
  apiKey: process.env.GOOGLE_API_KEY!,
  model: 'gemini-1.5-pro'
});
```

## Supported Models

- gemini-1.5-pro
- gemini-1.5-flash
- gemini-2.0-flash
- And other Gemini models

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
