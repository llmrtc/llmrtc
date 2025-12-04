---
title: Hooks & Metrics
---

LLMRTC exposes hooks and a pluggable metrics adapter so you can log, meter, and enforce guardrails across the pipeline.

## Hooks lifecycle (high level)
- Connection: `onConnection`, `onDisconnect`
- Speech: `onSpeechStart`, `onSpeechEnd`
- Turn: `onTurnStart`, `onTurnEnd`
- STT: `onSTTStart`, `onSTTEnd`, `onSTTError`
- LLM: `onLLMStart`, `onLLMChunk`, `onLLMEnd`, `onLLMError`
- TTS: `onTTSStart`, `onTTSChunk`, `onTTSEnd`, `onTTSError`
- Errors: `onError` with structured codes (stt, llm, tts, vad, webrtc, server, tool, playbook)
- Playbooks: `onStageEnter`, `onStageExit`, `onTransition`, `onPlaybookTurnEnd`, `onPlaybookComplete`

Hook context includes `sessionId`, `turnId`, and timing info for correlation.

## Metrics adapter
Implement `MetricsAdapter` (see `packages/core/src/metrics.ts`) to export timings and counters.

Common metrics emitted
- `llmrtc.stt.duration_ms`
- `llmrtc.llm.ttft_ms` (time to first token)
- `llmrtc.llm.duration_ms`
- `llmrtc.tts.duration_ms`
- `llmrtc.turn.duration_ms`
- `llmrtc.errors` (tagged by component)
- Playbook metrics: `llmrtc.playbook.stage.duration_ms`, `llmrtc.playbook.transitions`, `llmrtc.playbook.completions`

Example Prometheus adapter (sketch)
```ts
class PrometheusMetrics implements MetricsAdapter {
  timing(name, durationMs, tags) {
    histograms[name].observe(tags, durationMs);
  }
  increment(name, value = 1, tags) {
    counters[name].inc(tags, value);
  }
  gauge(name, value, tags) {
    gauges[name].set(tags, value);
  }
}
```

## Guardrails
Use hooks to enforce policies:
- Block unsafe content in `onLLMEnd` or `onTTSStart`.
- Drop attachments or redact transcripts before logging.
- Abort long turns with `AbortController` tied into hooks.

## Where to start
- For quick logging, use `createLoggingHooks` from `@metered/llmrtc-core` (see `packages/core/src/logging-hooks.ts`).
- See `examples/observability` for full servers with logging, metrics, guardrails, and custom sentence chunking.
