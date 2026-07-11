# @llmrtc/llmrtc-provider-zai

Z.ai GLM adapter for [LLMRTC](https://www.llmrtc.org) - realtime voice and
vision AI agents over WebRTC.

```typescript
import { ZaiLLMProvider } from '@llmrtc/llmrtc-provider-zai';

const llm = new ZaiLLMProvider({
  apiKey: process.env.ZAI_API_KEY!,
  model: 'glm-5.2'
});
```

GLM 5.2 is an open-weight (MIT) MoE model with a 1M-token context window and
strong tool calling at low cost. GLM models are also reachable through
OpenRouter (`@llmrtc/llmrtc-provider-openrouter` with model `z-ai/glm-5.2`).

See the [documentation](https://www.llmrtc.org) for the full guide.
