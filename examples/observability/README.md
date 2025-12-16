# Observability Examples

These examples demonstrate the hooks and metrics system in `@llmrtc/llmrtc-backend`. Each example is a complete, runnable server showcasing different observability features.

## Examples

| Example | Description | Key Features |
|---------|-------------|--------------|
| `server-logging.ts` | Structured logging | `createLoggingHooks()`, custom loggers, timing output |
| `server-metrics.ts` | Custom metrics | Prometheus-style adapter, `/metrics` endpoint |
| `server-guardrails.ts` | Content validation | Input/output filtering, safety hooks |
| `server-chunker.ts` | i18n sentence chunking | Japanese/Chinese punctuation, custom boundaries |

## Prerequisites

1. **API Keys** - Set in `.env` file:
   ```bash
   OPENAI_API_KEY=sk-...
   ELEVENLABS_API_KEY=...
   ```

2. **Install Dependencies**:
   ```bash
   cd examples/observability
   npm install
   ```

## Running Examples

Each example has its own npm script:

```bash
# Terminal 1: Start the server
npm run dev:logging      # Structured logging example
npm run dev:metrics      # Metrics adapter example
npm run dev:guardrails   # Content validation example
npm run dev:chunker      # i18n chunker example

# Terminal 2: Start the client
npm run dev:client
```

Then open http://localhost:5173 in your browser.

## Example Details

### 1. Logging Example (`server-logging.ts`)

Shows how to add structured logging with timing information:

```typescript
import { createLoggingHooks } from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  hooks: createLoggingHooks({
    level: 'info',           // 'debug' | 'info' | 'warn' | 'error'
    includePayloads: false,  // Include STT text, LLM responses in logs
    prefix: '[myapp]'        // Custom log prefix
  })
});
```

**Output:**
```
[myapp] Turn started: turn=abc123 session=xyz789
[myapp] STT completed: turn=abc123 duration=142ms
[myapp] LLM completed: turn=abc123 duration=312ms chars=156
[myapp] TTS completed: turn=abc123 duration=89ms
[myapp] Turn completed: turn=abc123 duration=543ms
```

### 2. Metrics Example (`server-metrics.ts`)

Shows how to build a custom metrics adapter for Prometheus/DataDog:

```typescript
import { MetricsAdapter, MetricNames } from '@llmrtc/llmrtc-backend';

class PrometheusMetrics implements MetricsAdapter {
  private timings: Map<string, number[]> = new Map();

  timing(name: string, durationMs: number, tags?: Record<string, string>) {
    // Collect histogram buckets
    const key = `${name}:${JSON.stringify(tags)}`;
    if (!this.timings.has(key)) this.timings.set(key, []);
    this.timings.get(key)!.push(durationMs);
  }

  // Expose /metrics endpoint for Prometheus scraping
  getMetrics(): string {
    // Format as Prometheus exposition format
  }
}
```

**Metrics Available:**
- `llmrtc.stt.duration_ms` - STT latency
- `llmrtc.llm.ttft_ms` - Time to first LLM token
- `llmrtc.llm.duration_ms` - Total LLM time
- `llmrtc.tts.duration_ms` - TTS generation time
- `llmrtc.turn.duration_ms` - Total turn time
- `llmrtc.errors` - Error counter by component

### 3. Guardrails Example (`server-guardrails.ts`)

Shows how to implement content validation and safety hooks:

```typescript
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  hooks: {
    // Validate LLM output before TTS
    async onLLMEnd(ctx, result, timing) {
      if (containsBadContent(result.fullText)) {
        throw new Error('Content policy violation');
      }
    },

    // Validate user input after STT
    async onSTTEnd(ctx, result, timing) {
      if (isSpam(result.text)) {
        throw new Error('Spam detected');
      }
    },

    // Central error handling
    onError(error, context) {
      reportToSentry(error, { turnId: context.turnId });
    }
  }
});
```

### 4. Sentence Chunker Example (`server-chunker.ts`)

Shows how to customize sentence boundary detection for streaming TTS:

```typescript
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  streamingTTS: true,

  // Custom sentence chunker for Japanese/Chinese
  sentenceChunker: (text) => {
    // Split on Western AND CJK punctuation
    return text.split(/(?<=[.!?。！？])\s*/);
  }
});
```

**Default vs Custom:**
- Default: Splits on `.!?` followed by whitespace
- Custom: Can handle `。！？` (CJK), `...`, or any pattern

## Combining Features

You can combine all features in a single server:

```typescript
const server = new LLMRTCServer({
  providers: { llm, stt, tts },

  hooks: {
    ...createLoggingHooks({ level: 'info' }),

    // Add guardrails on top of logging
    async onLLMEnd(ctx, result, timing) {
      if (result.fullText.includes('forbidden')) {
        throw new Error('Content blocked');
      }
    }
  },

  metrics: new PrometheusMetrics(),
  sentenceChunker: (text) => text.split(/(?<=[.!?。！？])\s*/)
});
```

## Hook Reference

| Hook | When Called | Arguments |
|------|-------------|-----------|
| `onConnection` | WebSocket connects | `sessionId, connectionId` |
| `onDisconnect` | WebSocket closes | `sessionId, timing` |
| `onSpeechStart` | VAD detects speech | `sessionId, timestamp` |
| `onSpeechEnd` | VAD detects silence | `sessionId, timestamp, audioDurationMs` |
| `onTurnStart` | Turn begins | `ctx, audio` |
| `onSTTStart` | STT starts | `ctx, audio` |
| `onSTTEnd` | STT completes | `ctx, result, timing` |
| `onSTTError` | STT fails | `ctx, error` |
| `onLLMStart` | LLM starts | `ctx, request` |
| `onLLMChunk` | LLM streams chunk | `ctx, chunk, chunkIndex` |
| `onLLMEnd` | LLM completes | `ctx, result, timing` |
| `onLLMError` | LLM fails | `ctx, error` |
| `onTTSStart` | TTS starts | `ctx, text` |
| `onTTSChunk` | TTS streams chunk | `ctx, chunk, chunkIndex` |
| `onTTSEnd` | TTS completes | `ctx, timing` |
| `onTTSError` | TTS fails | `ctx, error` |
| `onTurnEnd` | Turn completes | `ctx, timing` |
| `onError` | Any error | `error, errorContext` |
