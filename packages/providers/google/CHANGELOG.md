# @llmrtc/llmrtc-provider-google

## 1.3.0

### Minor Changes

- 3f9e7be: Realtime relay milestone 4 (RFC 0001): Gemini Live adapter.
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

### Patch Changes

- Updated dependencies [6a74624]
- Updated dependencies [2cc97a0]
- Updated dependencies [3db8818]
  - @llmrtc/llmrtc-core@1.3.0

## 1.2.0

### Minor Changes

- fd91344: Anthropic modernization and richer stop reasons.
  - The StopReason union gains `refusal`, `content_filter`, `pause_turn`, and
    `context_overflow`. Note for TypeScript consumers with exhaustive switches:
    this widens the union. OpenAI-compatible providers now report
    `content_filter` for filtered responses (previously mis-reported as
    `stop_sequence`); Gemini safety blocks and Bedrock guardrail interventions
    also map to `content_filter`.
  - The Anthropic provider defaults to `claude-sonnet-5` and automatically
    omits temperature/top_p for model families that reject them (Sonnet 5,
    Opus 4.7+, Fable tier), with a `samplingParamsSupported` override. The
    Bedrock provider applies the same guard for Claude models.
  - Orchestrators log a warning when a turn ends with an unusual stop reason.
  - CLI and example fallbacks move off retired model ids.

### Patch Changes

- Updated dependencies [fd91344]
- Updated dependencies [319bb47]
- Updated dependencies [a7d1ecc]
  - @llmrtc/llmrtc-core@1.2.0

## 1.1.0

### Minor Changes

- 8ff3ea3: Correctness release: make the advertised behavior actually work end to end.
  - Core: system prompt is always sent and pinned outside the history window;
    runTurnStream accepts an AbortSignal (barge-in); onLLMEnd has real
    guardrail semantics; concurrent turns serialize correctly; clearHistory
    transitions clear conversation history; PlaybookHooks are wired; tool
    executor abort/ordering fixes; deep tool-argument validation.
  - Providers: multi-turn tool calling now works across OpenAI, Anthropic,
    Gemini, Bedrock, OpenRouter, LMStudio, and Ollama (history replay,
    parallel tool results, streaming accumulation); malformed tool arguments
    are flagged instead of silently becoming {}; Bedrock defaults to an
    invocable inference profile; Ollama NDJSON streaming is buffered
    correctly; ElevenLabs format mapping fixed; Whisper uploads are named by
    their actual container.
  - Backend: turns serialize per connection and barge-in aborts the in-flight
    turn in any phase; session reconnection binds the recovered history;
    Metered TURN credentials refresh on a TTL; start()/stop() lifecycle
    fixes; real-time audio pacing.
  - Web client: vision frames are delivered in time to reach the turn;
    session resume follows the protocol and actually restores history;
    close()/failure releases the microphone and camera; frame capture works
    outside Chromium; non-WebRTC fallback (sendAudio/ttsChunk) is usable.
  - Packaging: packages resolve under require(), clean checkouts build first
    try, and npm tarballs ship the NOTICE file.

### Patch Changes

- Updated dependencies [8ff3ea3]
  - @llmrtc/llmrtc-core@1.1.0
