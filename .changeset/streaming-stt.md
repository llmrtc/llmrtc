---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-backend": minor
"@llmrtc/llmrtc-provider-elevenlabs": minor
"@llmrtc/llmrtc-provider-openai": minor
---

Streaming speech-to-text: live interim transcripts while the user speaks.

- New ElevenLabsScribeProvider: batch STT via Scribe v2 and realtime
  streaming via the Scribe v2 Realtime WebSocket (sub-150ms partials).
- New OpenAIRealtimeSTTProvider: streaming transcription over the OpenAI
  Realtime API (gpt-realtime-whisper by default; audio-duration billing).
- Opt-in server mode streamingSTT (CLI: STREAMING_STT=true) streams mic
  audio to the STT provider from VAD speech start, relaying partial
  transcripts to the client over the existing transcript/isFinal
  protocol; falls back to buffered STT when the provider can't stream.
- Both orchestrators gain runTurnStreamFromAudioStream; STTProvider
  gains an optional streamingInputSampleRate hint; core exports an
  AsyncEventQueue utility. Buffered STT remains the default.
- Streaming sockets carry watchdog timeouts (connect/inactivity/final)
  and surface early closes or transcription failures as turn errors
  instead of silently dropping the utterance.
- Behavior notes: the onSpeechStart server hook now fires after barge-in
  cancellation, so a slow hook can no longer delay interruptions;
  STT_PROVIDER=elevenlabs now selects ElevenLabs Scribe (previously it
  silently fell back to OpenAI Whisper).
