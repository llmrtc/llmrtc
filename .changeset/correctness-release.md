---
"@llmrtc/llmrtc-core": minor
"@llmrtc/llmrtc-backend": minor
"@llmrtc/llmrtc-web-client": minor
"@llmrtc/llmrtc-provider-openai": minor
"@llmrtc/llmrtc-provider-anthropic": minor
"@llmrtc/llmrtc-provider-google": minor
"@llmrtc/llmrtc-provider-bedrock": minor
"@llmrtc/llmrtc-provider-openrouter": minor
"@llmrtc/llmrtc-provider-lmstudio": minor
"@llmrtc/llmrtc-provider-elevenlabs": minor
"@llmrtc/llmrtc-provider-local": minor
---

Correctness release: make the advertised behavior actually work end to end.

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
