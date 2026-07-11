---
"@llmrtc/llmrtc-provider-anthropic": minor
"@llmrtc/llmrtc-backend": minor
---

Anthropic prompt caching for multi-turn voice conversations.

- Opt-in promptCaching flag on AnthropicLLMProvider: places an ephemeral
  cache breakpoint on the system prompt (covering tool definitions) and
  a rolling breakpoint on the last message, so each turn reuses the
  previous turn's prefix. Cache reads cost 0.1x input price - typically
  ~90% off input costs from turn 2 onward, with lower latency.
- CLI: ANTHROPIC_PROMPT_CACHING=true.
- Off by default; prefixes below the model's minimum cacheable length
  are simply not cached (no errors).
