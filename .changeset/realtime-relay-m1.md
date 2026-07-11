---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-backend": minor
"@llmrtc/llmrtc-provider-openai": minor
---

Experimental realtime speech-to-speech relay mode (RFC 0001, M1).

- New opt-in realtimeSpeech server mode: sessions connect to a native
  speech-to-speech model over the provider's WebSocket instead of the
  STT-LLM-TTS pipeline, for ~300-500ms voice-to-voice latency.
- OpenAIRealtimeSpeechProvider (gpt-realtime-2.1 family): bidirectional
  24kHz PCM, user/assistant transcripts, provider-side turn detection,
  barge-in with response cancellation and history truncation, per-
  response usage, session-expiry warning ahead of the 60-minute cap.
- Relay orchestrator with a decoupled control loop, epoch-tagged
  playback queue, and independent pacer, so interruption reaction is
  bounded regardless of response length; final transcripts are mirrored
  into session history.
- Protocol (additive): assistant-transcript and usage messages,
  ready.mode, REALTIME_ERROR/BUDGET_EXCEEDED error codes.
- M1 scope: tool bridging, budgets, session renewal, playbooks, client
  reconnect grace, and the Gemini adapter land in subsequent milestones.
