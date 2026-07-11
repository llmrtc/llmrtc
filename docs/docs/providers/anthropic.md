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
- Optional: `ANTHROPIC_MODEL`, `ANTHROPIC_PROMPT_CACHING`

## Prompt caching

Voice conversations resend the system prompt and the full history on
every turn - a perfect fit for Anthropic's prompt caching. Enable it
with one flag:

```ts
const llm = new AnthropicLLMProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  promptCaching: true
});
```

CLI mode: `ANTHROPIC_PROMPT_CACHING=true`.

The provider places an ephemeral cache breakpoint on the system prompt
(the cached prefix also covers tool definitions) and a rolling
breakpoint on the last message of each request, so every turn reuses the
previous turn's prefix.

### What it saves

Cache writes cost **1.25x** the input price, cache reads **0.1x**. For a
conversation with a 2,000-token system prompt and ~10 turns on
`claude-sonnet-5` ($3/M input):

| | Without caching | With caching |
|---|---|---|
| Turn 1 | 2,000 tokens x $3/M | 2,000 x $3.75/M (write) |
| Turn 10 | ~6,500 tokens x $3/M | ~500 new x $3.75/M + ~6,000 cached x $0.30/M |
| ~10-turn total | ~$0.13 | ~$0.03 |

The longer the system prompt (playbooks, tool definitions) and the
conversation, the larger the saving - typically **~90% off input costs**
from turn 2 onward. Latency also improves because cached prefix tokens
are not re-processed.

Verified behavior (live): turn 1 reports `cache_creation_input_tokens`,
turn 2+ report the full prefix in `cache_read_input_tokens` (visible on
`LLMResult.raw.usage`).

Caching notes
- Prefixes below the model's minimum cacheable length (~1024 tokens on
  Sonnet/Opus models, 2048 on Haiku) are not cached; the flag is then a
  no-op, never an error.
- The cache has a 5-minute TTL, refreshed on every hit - active
  conversations keep it warm.
- Applies to the direct Anthropic provider; the Bedrock provider does
  not implement caching yet.

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
