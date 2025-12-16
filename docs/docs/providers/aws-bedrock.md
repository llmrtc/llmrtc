---
title: AWS Bedrock
---

Supported
- Anthropic Claude, Amazon Nova, Meta Llama, Mistral models via Bedrock
- Streaming supported where the underlying model allows

Setup
```ts
import { BedrockLLMProvider } from '@llmrtc/llmrtc-provider-bedrock';

const llm = new BedrockLLMProvider({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  },
  model: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
});
```

Env vars
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Optional: `BEDROCK_MODEL`

Notes
- Good for customers already on AWS; watch per-model throttles.
