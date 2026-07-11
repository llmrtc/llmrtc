---
"@llmrtc/llmrtc-provider-google": minor
"@llmrtc/llmrtc-backend": minor
---

Realtime relay milestone 4 (RFC 0001): Gemini Live adapter.

- New GeminiLiveSpeechProvider: speech-to-speech over the Gemini Live
  API (gemini-3.1-flash-live-preview by default; the Live API is a
  Google preview). 16kHz PCM in / 24kHz out, native user and assistant
  transcripts, provider-driven barge-in, tool calls with cancellation.
- Gemini's ~10-minute socket lifetime is handled inside the adapter:
  goAway (and socket loss) trigger a session-resumption reconnect with
  bounded input-audio buffering, so user speech spanning the gap is
  replayed rather than clipped. Stage instruction updates use a
  system-text turn without reconnecting; tool-set changes reconnect
  with the resumption handle.
- Cost controls hold on Gemini too: maxOutputTokens maps into
  generationConfig, and usageMetadata feeds per-response usage events,
  budget enforcement, and spend metrics.
- Reconnects retry with backoff, treat resumption handles as
  single-use (falling back to a fresh session rather than dying),
  drain trailing messages from the old socket, buffer tool results
  across the gap, and close interrupted turns cleanly so client state
  never dangles.
- Conformance-tested against the documented BidiGenerateContent wire
  format (mock server incl. handle rotation and close-during-reconnect).
  Live validation is pending an API key environment; wire shapes marked
  LIVE-PROBE in the adapter (system-role instruction turns, tool-result
  delivery across a resumption) must be confirmed before
  playbooks-on-Gemini leave experimental status.
