---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-backend": minor
---

Realtime relay milestone 2 (RFC 0001): tools, budgets, session renewal.

- Tool bridging: the same ToolRegistry definitions drive provider-native
  function calling; calls execute through ToolExecutor (timeouts, abort
  support) without blocking the relay control loop, with results
  returned to the live session and tool-call-start/end relayed to
  clients. Provider-side cancellations abort in-flight executions.
- Session budgets: maxSessionMs (default 120 minutes) and maxTokens
  guardrails with warn or end-session behavior; ending emits
  BUDGET_EXCEEDED and closes the provider session.
- OpenAI 60-minute session renewal: near expiry (session-expiring
  events now carry a renewable flag in core) the orchestrator opens a
  fresh provider session seeded from the mirrored transcript history
  and swaps it in at a quiet moment; in-flight work is aborted cleanly
  if quiescence cannot be reached. The onSessionRenewed hook is
  deferred to a later milestone.
- Budget end-session reports exactly one BUDGET_EXCEEDED error to the
  client; tool bridge failures (unserializable results) are contained
  per call instead of crashing the process.
