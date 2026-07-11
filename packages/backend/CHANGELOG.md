# @llmrtc/llmrtc-backend

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
