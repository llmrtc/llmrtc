---
title: Error Codes
---

- `WEBRTC_UNAVAILABLE` – Server missing WebRTC support
- `AUDIO_PROCESSING_ERROR` – VAD or decoding failed
- `STT_ERROR` – Speech-to-text provider failed
- `LLM_ERROR` – LLM provider failed
- `TTS_ERROR` – Text-to-speech provider failed
- `TOOL_ERROR` – Tool execution failed
- `PLAYBOOK_ERROR` – Playbook orchestration failed
- `INVALID_MESSAGE` – Malformed/unknown message
- `SESSION_NOT_FOUND` – Reconnect with invalid session
- `INTERNAL_ERROR` – Unexpected server error

Clients should surface user-friendly messages and optionally retry when safe.
