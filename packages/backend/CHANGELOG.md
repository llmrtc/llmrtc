# @llmrtc/llmrtc-backend

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

- 2cc97a0: Realtime relay milestone 2 (RFC 0001): tools, budgets, session renewal.
  - Tool bridging: the same ToolRegistry definitions drive provider-native
    function calling; calls execute through ToolExecutor (timeouts, abort
    support) without blocking the relay control loop, with results
    returned to the live session and tool-call-start/end relayed to
    clients. Provider-side cancellations abort in-flight executions.
  - Session budgets: maxSessionMs (default 120 minutes) and maxTokens
    guardrails with warn or end-session behavior; ending emits
    BUDGET_EXCEEDED and closes the provider session.
  - OpenAI 60-minute session renewal: near expiry (session-expiring
    events now carry a renewable flag in core) the orchestrator opens a
    fresh provider session seeded from the mirrored transcript history
    and swaps it in at a quiet moment; in-flight work is aborted cleanly
    if quiescence cannot be reached. The onSessionRenewed hook is
    deferred to a later milestone.
  - Budget end-session reports exactly one BUDGET_EXCEEDED error to the
    client; tool bridge failures (unserializable results) are contained
    per call instead of crashing the process.

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

- 24fbcd4: Realtime relay milestone 5 (RFC 0001): pipeline fallback and hardening.
  - Connect-time fallback: when the realtime provider is unreachable and
    pipeline providers are configured, the session starts in pipeline
    mode instead of failing. Mid-session provider failures send
    an advisory mode-changed {mode: 'pipeline'}; the auto-reconnect lands
    on the fallback if the provider is still unreachable (ready.mode is
    authoritative).
  - Renewal-crossing soak coverage: a fake-provider soak test exercises
    repeated renewals with tool traffic asserting no leaked sessions or
    dangling state, and the live probe verified a real OpenAI session
    renewal mid-conversation with memory preserved through the
    transcript seed.
  - Docs: fallback behavior and scale notes.

### Patch Changes

- Updated dependencies [6a74624]
- Updated dependencies [2cc97a0]
- Updated dependencies [3db8818]
- Updated dependencies [3f9e7be]
  - @llmrtc/llmrtc-core@1.3.0
  - @llmrtc/llmrtc-provider-openai@1.3.0
  - @llmrtc/llmrtc-provider-google@1.3.0

## 1.2.0

### Minor Changes

- 7705cad: Anthropic prompt caching for multi-turn voice conversations.
  - Opt-in promptCaching flag on AnthropicLLMProvider: places an ephemeral
    cache breakpoint on the system prompt (covering tool definitions) and
    a rolling breakpoint on the last message, so each turn reuses the
    previous turn's prefix. Cache reads cost 0.1x input price - typically
    ~90% off input costs from turn 2 onward, with lower latency.
  - CLI: ANTHROPIC_PROMPT_CACHING=true.
  - Off by default; prefixes below the model's minimum cacheable length
    are simply not cached (no errors).

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

- 246b6f6: New model ecosystems: Z.ai GLM and current local vision models.
  - New @llmrtc/llmrtc-provider-zai package: ZaiLLMProvider for Z.ai's GLM
    family (default glm-5.2 - 1M context, open weights, strong tool calling)
    via the OpenAI-compatible API, with full tool-calling and streaming
    support. CLI: LLM_PROVIDER=zai with ZAI_API_KEY/ZAI_MODEL.
  - Local vision generalized: OllamaVisionProvider works with any
    vision-capable Ollama model and defaults to qwen3-vl;
    LlavaVisionProvider remains as a compatible alias defaulting to llava.
    CLI: OLLAMA_VISION_MODEL selects the model (the CLI default stays
    llava, so existing LOCAL_ONLY deployments are unaffected - set
    OLLAMA_VISION_MODEL=qwen3-vl to opt in). The CLI vision provider now
    also honors OLLAMA_BASE_URL. Qwen 3.6 multimodal runs through LM
    Studio vision attachments (Ollama GGUF support pending upstream).

### Patch Changes

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

- 232e4d0: The CLI now honors the documented HISTORY_LIMIT environment variable;
  previously it was silently ignored in CLI mode.
- Updated dependencies [fd91344]
- Updated dependencies [7705cad]
- Updated dependencies [552005e]
- Updated dependencies [319bb47]
- Updated dependencies [a7d1ecc]
- Updated dependencies [246b6f6]
  - @llmrtc/llmrtc-core@1.2.0
  - @llmrtc/llmrtc-provider-anthropic@1.2.0
  - @llmrtc/llmrtc-provider-bedrock@1.2.0
  - @llmrtc/llmrtc-provider-google@1.2.0
  - @llmrtc/llmrtc-provider-openai@1.2.0
  - @llmrtc/llmrtc-provider-openrouter@1.2.0
  - @llmrtc/llmrtc-provider-lmstudio@1.2.0
  - @llmrtc/llmrtc-provider-elevenlabs@1.2.0
  - @llmrtc/llmrtc-provider-zai@1.2.0
  - @llmrtc/llmrtc-provider-local@1.2.0

## 1.1.1

### Patch Changes

- 6380c16: The CLI now refuses to start on Node versions below 20 with a clear
  message (override with LLMRTC_SKIP_NODE_CHECK=1). Unsupported runtimes
  previously failed in confusing ways at runtime instead of at startup.
- Updated dependencies [b35b4e1]
  - @llmrtc/llmrtc-provider-openai@1.1.1

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
  - @llmrtc/llmrtc-provider-openai@1.1.0
  - @llmrtc/llmrtc-provider-anthropic@1.1.0
  - @llmrtc/llmrtc-provider-google@1.1.0
  - @llmrtc/llmrtc-provider-bedrock@1.1.0
  - @llmrtc/llmrtc-provider-openrouter@1.1.0
  - @llmrtc/llmrtc-provider-lmstudio@1.1.0
  - @llmrtc/llmrtc-provider-elevenlabs@1.1.0
  - @llmrtc/llmrtc-provider-local@1.1.0
