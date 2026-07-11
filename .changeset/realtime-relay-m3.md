---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-backend": minor
"@llmrtc/llmrtc-web-client": minor
"@llmrtc/llmrtc-provider-openai": minor
---

Realtime relay milestone 3 (RFC 0001): playbooks, client events,
reconnect grace.

- Playbooks work in relay mode (llm_decision transitions;
  clearHistory and per-stage llmConfig are not applied in relay mode): playbook_transition tool calls
  reconfigure the live session's instructions and tools via the shared
  PlaybookEngine, emit stage-change to clients, and nudge the model to
  speak the new stage.
- Web client: new assistantTranscript and usage events, plus a
  reserved modeChanged event (mid-session pipeline fallback ships in a
  later milestone);
  new mode-changed protocol message; session interface gains optional
  requestResponse (OpenAI adapter implements it).
- Client reconnect grace: a dropped client has clientReconnectGraceMs
  (default 30s) to reconnect and adopt its still-live provider session
  (honest historyRecovered semantics); playback re-targets the new
  peer.
- New docs page: Realtime Speech-to-Speech (experimental).
