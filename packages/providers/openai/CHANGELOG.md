# @llmrtc/llmrtc-provider-openai

## 1.3.0

### Minor Changes

- 6a74624: Experimental realtime speech-to-speech relay mode (RFC 0001, M1).
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

- 3db8818: Realtime relay milestone 3 (RFC 0001): playbooks, client events,
  reconnect grace.
  - Playbooks work in relay mode (llm_decision transitions;
    clearHistory and per-stage llmConfig are not applied in relay mode): playbook_transition tool calls
    reconfigure the live session's instructions and tools via the shared
    PlaybookEngine, emit stage-change to clients, and nudge the model to
    speak the new stage.
  - Web client: new assistantTranscript and usage events, plus a
    reserved modeChanged event (mid-session pipeline fallback ships in a
    later milestone);
    new mode-changed protocol message; session interface gains optional
    requestResponse (OpenAI adapter implements it).
  - Client reconnect grace: a dropped client has clientReconnectGraceMs
    (default 30s) to reconnect and adopt its still-live provider session
    (honest historyRecovered semantics); playback re-targets the new
    peer.
  - New docs page: Realtime Speech-to-Speech (experimental).

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

- 319bb47: OpenAI voice updates: steerable TTS and current transcription models.
  - TTSConfig gains an optional `instructions` field for instructable TTS
    models. OpenAITTSProvider accepts `instructions` at the constructor and
    per call, sends them for gpt-\* models (e.g. gpt-4o-mini-tts), and
    ignores them with a one-time warning on tts-1/tts-1-hd.
  - OpenAITTSVoice widened to the current voice roster (adds ash, ballad,
    coral, sage, verse) while accepting any string for forward
    compatibility; TTS model accepts any string. Note: code doing
    exhaustive switches over OpenAITTSVoice will need adjusting, matching
    the same widening in the official openai SDK. ballad/verse require
    gpt-4o-mini-tts; the other nine voices work on all TTS models.
  - OpenAIWhisperProvider documents gpt-4o-transcribe /
    gpt-4o-mini-transcribe support.
  - CLI: new OPENAI_STT_MODEL, OPENAI_TTS_MODEL, and
    OPENAI_TTS_INSTRUCTIONS environment variables.

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

## 1.1.1

### Patch Changes

- b35b4e1: Fix streaming TTS failing with "response.body?.getReader is not a function"
  when the OpenAI SDK returns a Node Readable body (Node < 18 or apps loading
  the SDK's Node shims). The provider now handles web ReadableStream bodies,
  async-iterable Node stream bodies, and buffered fallback. Previously the
  error was caught upstream and every turn silently fell back to
  non-streaming TTS, adding seconds of latency.

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
