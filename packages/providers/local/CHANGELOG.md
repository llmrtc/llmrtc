# @llmrtc/llmrtc-provider-local

## 1.2.0

### Minor Changes

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
