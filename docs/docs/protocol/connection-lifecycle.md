---
title: Connection Lifecycle
---

1) WebSocket connect
2) Server → `ready` `{ id, protocolVersion }`
3) Client → `offer` (SDP)
4) Server → `signal` (SDP answer)
5) WebRTC data channel established
6) Heartbeats: `ping` / `pong`
7) Reconnect: client sends `reconnect` with previous sessionId; server replies `reconnect-ack`

Payload messages (transcripts, llm, tts, etc.) are sent on both channels; client should process from data channel when available, fallback to WebSocket otherwise.
