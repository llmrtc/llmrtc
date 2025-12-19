# @llmrtc/llmrtc-provider-lmstudio

LM Studio local LLM provider for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-lmstudio
```

## Usage

```typescript
import { LMStudioLLMProvider } from '@llmrtc/llmrtc-provider-lmstudio';

const llm = new LMStudioLLMProvider({
  baseUrl: 'http://localhost:1234/v1',
  model: 'local-model'
});
```

## Features

- Connect to local LM Studio server
- OpenAI-compatible API
- Run models locally without API keys
- Privacy-focused inference

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
