---
title: Monitoring
---

Track health of the voice pipeline end-to-end.

What to watch
- WebSocket/WebRTC connection counts and reconnect rates
- STT latency, LLM latency, TTS latency per provider
- Token usage and cost per session
- Error rates by provider/model

Endpoints
- `/health` for liveness; add custom checks for provider reachability if needed.

Dashboards
- Time-to-first-transcript
- Time-to-first-audio (TTS)
- Barge-in frequency
