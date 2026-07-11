# @llmrtc/llmrtc-provider-elevenlabs

## 1.2.0

### Minor Changes

- a7d1ecc: Streaming speech-to-text: live interim transcripts while the user speaks.
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
