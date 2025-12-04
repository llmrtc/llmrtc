---
title: Logging & Metrics
---

Logging
- Log connection lifecycle, tool calls, and provider responses (redact PII).
- Include `sessionId`, provider name, model, latency, token counts, and stage.
- Use `createLoggingHooks` for structured logs; add your own hooks for domain-specific events.

Metrics
- Record histograms for STT/LLM/TTS durations (`llmrtc.stt.duration_ms`, `llmrtc.llm.duration_ms`, `llmrtc.tts.duration_ms`).
- Track time-to-first-token (`llmrtc.llm.ttft_ms`) for latency regressions.
- Use gauges for active sessions and connections (`llmrtc.sessions.active`, `llmrtc.connections.active`).
- Count errors by component (`llmrtc.errors` with tags like `{ component: 'stt' }`).
- For playbooks, track `llmrtc.playbook.stage.duration_ms`, `llmrtc.playbook.transitions`, and `llmrtc.playbook.completions`.

Sampling & retention
- Sample verbose logs in production; keep top-level metrics unsampled where possible.
- Apply shorter log retention for payload-heavy logs; keep numeric metrics longer for trend analysis.
- Ensure retention and access controls match your data privacy policy.

Dashboards (suggested)
- Latency: P95 STT/LLM/TTS and turn duration, by provider/model.
- Reliability: error rate by component and provider, reconnection counts.
- Playbooks: average stage duration, transitions per stage, completion rate per playbook.
