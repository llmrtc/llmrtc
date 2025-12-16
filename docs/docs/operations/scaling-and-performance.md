---
title: Scaling & Performance
---

Backend & topology
- Keep media and signalling close to users; deploy regionally when possible.
- Provide TURN servers (see Backend → Networking & TURN) and test ICE connectivity on real networks (home, mobile, corporate).
- Use sticky sessions for WebSocket connections at your load balancer so reconnections hit the same node when possible.

Orchestrator & models
- Tune `historyLimit` and model choice (e.g., `gpt-5.1-mini`, `gemini-flash`) for latency/cost trade-offs.
- Pre-initialize providers (`init`) at startup to avoid first-call latency spikes.
- Use streaming everywhere (STT, LLM, TTS) to reduce time-to-first-byte; monitor `llmrtc.llm.ttft_ms`.

Node capacity & backpressure
- Limit concurrent sessions per node based on CPU usage and provider quotas; use `llmrtc.sessions.active` and `llmrtc.connections.active` from metrics.
- Use hooks to detect slow/stuck turns and abort via `AbortController` in your orchestrator options.
- Prefer scaling out multiple small nodes over one large node to isolate failures.

Cross-links
- Backend → Networking & TURN
- Backend → Observability & Hooks
- Operations → Logging & Metrics
