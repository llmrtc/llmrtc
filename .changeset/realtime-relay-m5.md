---
"@llmrtc/llmrtc-backend": minor
---

Realtime relay milestone 5 (RFC 0001): pipeline fallback and hardening.

- Connect-time fallback: when the realtime provider is unreachable and
  pipeline providers are configured, the session starts in pipeline
  mode instead of failing. Mid-session provider failures send
  an advisory mode-changed {mode: 'pipeline'}; the auto-reconnect lands
  on the fallback if the provider is still unreachable (ready.mode is
  authoritative).
- Renewal-crossing soak coverage: a fake-provider soak test exercises
  repeated renewals with tool traffic asserting no leaked sessions or
  dangling state, and the live probe verified a real OpenAI session
  renewal mid-conversation with memory preserved through the
  transcript seed.
- Docs: fallback behavior and scale notes.
