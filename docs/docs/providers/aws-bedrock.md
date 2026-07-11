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
  model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
});
```

Env vars
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Optional: `BEDROCK_MODEL`

Notes
- Good for customers already on AWS; watch per-model throttles.

## Sampling parameters on current Claude models

Claude Sonnet 5, Opus 4.7+, and Fable-tier models reject `temperature`/`top_p`
on the Converse API just as they do on the first-party Anthropic API. The
provider automatically omits configured sampling parameters for those model
families (with a one-time warning) instead of failing the request.
