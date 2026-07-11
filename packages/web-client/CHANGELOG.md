# @llmrtc/llmrtc-web-client

## 1.2.0

### Minor Changes

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
