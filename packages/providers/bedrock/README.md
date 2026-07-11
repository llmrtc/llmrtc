# @llmrtc/llmrtc-provider-bedrock

AWS Bedrock LLM provider for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-bedrock
```

## Usage

```typescript
import { BedrockLLMProvider } from '@llmrtc/llmrtc-provider-bedrock';

const llm = new BedrockLLMProvider({
  region: 'us-east-1',
  model: 'us.anthropic.claude-sonnet-5'
});
```

## Supported Models

- us.anthropic.claude-sonnet-5
- us.anthropic.claude-sonnet-4-5-20250929-v1:0
- anthropic.claude-3-haiku-20240307-v1:0
- amazon.titan-text-express-v1
- And other Bedrock models

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
