---
title: Z.ai (GLM)
---

LLM support via [Z.ai](https://z.ai)'s GLM family. GLM 5.2 is an open-weight
(MIT-licensed) mixture-of-experts model with a **1M-token context window**
and strong tool calling at a fraction of frontier-model cost — a compelling
choice for cost-sensitive voice agents that still need reliable function
calling.

## Official Documentation

- [Z.ai API Platform](https://z.ai/model-api)
- [GLM-5.2 Documentation](https://docs.z.ai/guides/llm/glm-5.2)
- [GLM 5.2 on OpenRouter](https://openrouter.ai/z-ai/glm-5.2)

## Setup

```bash
npm install @llmrtc/llmrtc-provider-zai
# or use the backend package, which re-exports it
npm install @llmrtc/llmrtc-backend
```

Get an API key from the [Z.ai platform](https://z.ai/model-api) and set it:

```bash
ZAI_API_KEY=your-key
```

## Usage

```typescript
import { LLMRTCServer, ZaiLLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new ZaiLLMProvider({
      apiKey: process.env.ZAI_API_KEY!,
      model: 'glm-5.2' // default
    }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY! })
  },
  systemPrompt: 'You are a helpful voice assistant.'
});

await server.start();
```

### CLI mode

```bash
LLM_PROVIDER=zai        # or 'glm'
ZAI_API_KEY=your-key
ZAI_MODEL=glm-5.2       # optional override
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Z.ai API key |
| `model` | `string` | `'glm-5.2'` | GLM model name |
| `baseURL` | `string` | `'https://api.z.ai/api/paas/v4'` | API endpoint (Z.ai coding-plan subscribers can point at the coding endpoint) |

## Tool calling

GLM 5.2 supports the full LLMRTC tool-calling flow — provider-agnostic
`ToolDefinition`s, parallel calls, streamed tool-call assembly, and playbook
two-phase execution — through the same OpenAI-compatible adapter used by
OpenRouter and LM Studio:

```typescript
import { ToolRegistry, defineTool } from '@llmrtc/llmrtc-backend';

const registry = new ToolRegistry();
registry.register(defineTool(
  {
    name: 'get_weather',
    description: 'Get the current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city']
    }
  },
  async ({ city }) => ({ city, temperature: 22 })
));

const result = await llm.complete({
  messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
  tools: registry.getDefinitions(),
  toolChoice: 'auto'
});
```

## Via OpenRouter

If you already use OpenRouter as a gateway, GLM models are available there
without a separate Z.ai key:

```typescript
import { OpenRouterLLMProvider } from '@llmrtc/llmrtc-backend';

const llm = new OpenRouterLLMProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'z-ai/glm-5.2'
});
```
