# @llmrtc/llmrtc-provider-anthropic

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

- 7705cad: Anthropic prompt caching for multi-turn voice conversations.
  - Opt-in promptCaching flag on AnthropicLLMProvider: places an ephemeral
    cache breakpoint on the system prompt (covering tool definitions) and
    a rolling breakpoint on the last message, so each turn reuses the
    previous turn's prefix. Cache reads cost 0.1x input price - typically
    ~90% off input costs from turn 2 onward, with lower latency.
  - CLI: ANTHROPIC_PROMPT_CACHING=true.
  - Off by default; prefixes below the model's minimum cacheable length
    are simply not cached (no errors).

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
