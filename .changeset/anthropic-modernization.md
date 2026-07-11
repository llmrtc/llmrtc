---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-provider-anthropic": minor
"@llmrtc/llmrtc-provider-bedrock": minor
"@llmrtc/llmrtc-provider-google": minor
"@llmrtc/llmrtc-provider-openai": minor
"@llmrtc/llmrtc-provider-openrouter": minor
"@llmrtc/llmrtc-provider-lmstudio": minor
"@llmrtc/llmrtc-backend": patch
---

Anthropic modernization and richer stop reasons.

- The StopReason union gains `refusal`, `content_filter`, `pause_turn`, and
  `context_overflow`. Note for TypeScript consumers with exhaustive switches:
  this widens the union. OpenAI-compatible providers now report
  `content_filter` for filtered responses (previously mis-reported as
  `stop_sequence`); Gemini safety blocks and Bedrock guardrail interventions
  also map to `content_filter`.
- The Anthropic provider defaults to `claude-sonnet-5` and automatically
  omits temperature/top_p for model families that reject them (Sonnet 5,
  Opus 4.7+, Fable tier), with a `samplingParamsSupported` override. The
  Bedrock provider applies the same guard for Claude models.
- Orchestrators log a warning when a turn ends with an unusual stop reason.
- CLI and example fallbacks move off retired model ids.
