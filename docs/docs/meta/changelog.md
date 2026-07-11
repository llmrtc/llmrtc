---
title: Changelog
---

This page tracks released versions of the SDK. Per-package changelogs live
alongside each package (`packages/*/CHANGELOG.md`) and on npm.

## 1.1.0 (2026-07-11)

Correctness release: makes the advertised behavior work end to end.

- **Core**: system prompt is always sent and pinned outside the history
  window; `runTurnStream` accepts an `AbortSignal` (barge-in) and commits
  the partial response to history; `onLLMEnd` has real guardrail semantics
  (throwing cancels the response); concurrent turns serialize correctly;
  `clearHistory` transitions clear conversation history; `PlaybookHooks`
  are wired; tool executor abort/ordering fixes; deep tool-argument
  validation.
- **Providers**: multi-turn tool calling now works across OpenAI,
  Anthropic, Gemini, Bedrock, OpenRouter, LMStudio, and Ollama; malformed
  tool arguments are flagged instead of silently becoming `{}`; Bedrock
  defaults to a current, invocable inference profile; Ollama NDJSON
  streaming is buffered correctly; ElevenLabs format mapping fixed;
  Whisper uploads are named by their actual container.
- **Backend**: turns serialize per connection and barge-in aborts the
  in-flight turn in any phase; session reconnection binds the recovered
  history; TURN credentials refresh on a TTL; `start()`/`stop()` lifecycle
  fixes; real-time audio pacing.
- **Web client**: vision frames are delivered in time to reach the turn;
  session resume follows the protocol and restores history (new
  `reconnected` event); `close()`/failure releases the microphone and
  camera; frame capture works outside Chromium; the non-WebRTC fallback
  (`sendAudio`/`ttsChunk`) is usable.
- **Packaging**: packages resolve under `require()`, clean checkouts build
  first try, npm tarballs ship NOTICE and CHANGELOG files.

## 1.0.0 (2025-12-19)

Initial public release.
