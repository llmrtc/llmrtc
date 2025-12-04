---
title: Message Types
---

Client → Server
- `ping { timestamp }`
- `offer { signal: SDP }`
- `reconnect { sessionId }`
- `audio { data, attachments? }` (fallback)
- `attachments { attachments[] }`

Server → Client
- `ready { id, protocolVersion }`
- `pong { timestamp }`
- `signal { signal: SDP }`
- `reconnect-ack { success, sessionId, historyRecovered }`
- `transcript { text, isFinal }`
- `llm-chunk { content, done }`
- `llm { text }`
- `tts-start`
- `tts-chunk { format, sampleRate, data }`
- `tts { format, data }`
- `tts-complete`
- `tts-cancelled`
- `speech-start`
- `speech-end`
- `tool-call-start { name, callId, arguments }`
- `tool-call-end { callId, result?, error?, durationMs }`
- `stage-change { from, to, reason }`
- `error { code, message }`
