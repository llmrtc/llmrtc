---
title: Anthropic
---

Supported
- LLM: `claude-sonnet-5` (default), `claude-opus-4-8`, `claude-haiku-4-5`, `claude-sonnet-4-5` (vision capable)
- Streaming supported

Setup
```ts
import { AnthropicLLMProvider } from '@llmrtc/llmrtc-provider-anthropic';

const llm = new AnthropicLLMProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-5'
});
```

Env vars
- `ANTHROPIC_API_KEY`
- Optional: `ANTHROPIC_MODEL`

Notes
- Great for tool use and longer context windows; latency slightly higher than OpenAI mini models.

## Model notes

- **Default model**: `claude-sonnet-5` - near-Opus quality on coding and
  agentic work at Sonnet pricing. Override with the `model` option or the
  `ANTHROPIC_MODEL` environment variable (CLI mode). The default is an
  alias that tracks Anthropic's latest Sonnet 5 snapshot; pin a dated model
  id in production if you need byte-identical behavior across deploys.
- **Overriding the sampling guard**: set `samplingParamsSupported: true` or
  `false` on the provider config to force-send or force-omit
  temperature/top_p regardless of the model id heuristic.
- **Sampling parameters**: Claude Sonnet 5, Opus 4.7+, and the Fable tier
  reject `temperature`/`top_p` at the API level. When one of these models is
  selected, the provider automatically omits any configured sampling
  parameters (and logs a one-time warning) instead of failing the request.
  Steer output style through the system prompt on these models.
- **Stop reasons**: in addition to `end_turn`, `tool_use`, `max_tokens`, and
  `stop_sequence`, current Claude models can return `refusal` (a safety
  system declined the request), `pause_turn` (a server-side tool loop paused),
  and `context_overflow` (the context window was exhausted). These surface on
  `LLMResult.stopReason` so applications can branch on them.
