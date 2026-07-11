# @llmrtc/llmrtc-backend

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
