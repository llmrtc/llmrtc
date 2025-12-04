---
title: Observability & Hooks
---

LLMRTC emits events and supports hooks so you can log, meter, and enforce guardrails without forking the server.

## Server events
- `listening({ host, port })`
- `connection({ id })`
- `disconnect({ id })`
- `error(error)`

Use these for coarse-grained connection logs or integration with your app’s own logger.

## Logging hooks

The backend re-exports `createLoggingHooks`, `createErrorOnlyHooks`, `createVerboseHooks`, and `createTimingHooks`.

```ts
import { LLMRTCServer, createLoggingHooks } from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  hooks: createLoggingHooks({
    level: 'info',          // 'debug' | 'info' | 'warn' | 'error'
    includePayloads: false, // set true to log STT/LLM text (careful with PII)
    prefix: '[llmrtc]',
    includeTimestamp: true
  })
});
```

This logs the full STT → LLM → TTS lifecycle with turn/session ids and durations. For minimal noise, use `createErrorOnlyHooks`; for debug traces, use `createVerboseHooks`.

## Metrics

Metrics are emitted via a `MetricsAdapter` (see Core SDK → Hooks & Metrics). The backend exports:
- `MetricNames` – standard metric keys (STT_DURATION, LLM_TTFT, LLM_DURATION, TTS_DURATION, TURN_DURATION, ERRORS, CONNECTIONS, TOOL_DURATION, STAGE_DURATION, etc.).
- `ConsoleMetrics` – logs metrics to stdout.
- `InMemoryMetrics` – useful in tests.

```ts
import { LLMRTCServer, ConsoleMetrics } from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  metrics: new ConsoleMetrics({ prefix: 'myapp' })
});
```

For Prometheus/DataDog, implement your own `MetricsAdapter` and pass it as `metrics`.

## Guardrails with hooks

Use orchestrator hooks to enforce policies and route errors:

```ts
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  hooks: {
    // Validate user input after STT
    async onSTTEnd(ctx, result, timing) {
      if (isSpam(result.text)) throw new Error('Spam detected');
    },

    // Validate assistant output before TTS
    async onLLMEnd(ctx, result, timing) {
      if (containsBadContent(result.fullText)) {
        throw new Error('Content policy violation');
      }
    },

    // Central error handling
    onError(error, context) {
      reportToSentry(error, context);
    }
  }
});
```

## Recommendations
- Forward metrics to Prometheus or OpenTelemetry; tag by provider/model/stage.
- Redact PII before logging transcripts or LLM payloads.
- Sample verbose logs in production; keep metrics unsampled where possible.
- Combine logging hooks with guardrail hooks instead of duplicating logic.

See also:
- Core SDK → Hooks & Metrics
- Recipes → Observability & Metrics
- `examples/observability` for full servers with logging, metrics, guardrails, and custom sentence chunking.
