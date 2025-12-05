---
title: Server Configuration
---

Complete reference for `LLMRTCServer` configuration options.

## Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `providers` | `ConversationProviders` | **required** | LLM, STT, TTS provider instances |
| `port` | `number` | `8787` | TCP port to listen on |
| `host` | `string` | `'127.0.0.1'` | Bind address |
| `systemPrompt` | `string` | `'You are a helpful assistant.'` | Base system prompt |
| `historyLimit` | `number` | `8` | Messages retained in context |
| `streamingTTS` | `boolean` | `true` | Enable streaming TTS (requires FFmpeg) |
| `heartbeatTimeout` | `number` | `45000` | Milliseconds before disconnect on no heartbeat |
| `cors` | `CorsOptions` | `undefined` | CORS configuration |

```typescript
interface ConversationProviders {
  llm: LLMProvider;
  stt: STTProvider;
  tts: TTSProvider;
  vision?: VisionProvider;  // Optional for image analysis
}
```

---

## Playbook Mode Options

When using playbooks for multi-stage voice agents with tools:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `playbook` | `Playbook` | `undefined` | Playbook definition with stages/transitions |
| `toolRegistry` | `ToolRegistry` | `undefined` | Registry with tools (required with playbook) |
| `playbookOptions` | `object` | see below | Playbook orchestrator options |

### Playbook Orchestrator Options

```typescript
interface PlaybookOrchestratorOptions {
  /** Maximum tool calls per turn in Phase 1 */
  maxToolCallsPerTurn?: number;  // Default: 10

  /** Timeout for Phase 1 tool loop (ms) */
  phase1TimeoutMs?: number;  // Default: 60000 (1 minute)

  /** Number of LLM retry attempts on failure */
  llmRetries?: number;  // Default: 3

  /** Maximum conversation history messages */
  historyLimit?: number;  // Default: 50

  /** Enable debug logging */
  debug?: boolean;  // Default: false
}
```

**LLM Retry Logic:**

The orchestrator includes smart retry with exponential backoff:

- **Retries on:** Rate limits (429), server errors (5xx), timeouts
- **No retry on:** Client errors (400, 401, 403, 404)
- **Backoff:** 1s → 2s → 4s (exponential)

---

## ICE Server Configuration

WebRTC requires ICE servers for NAT traversal. See [Networking & TURN](networking-and-turn) for details.

| Option | Type | Description |
|--------|------|-------------|
| `iceServers` | `RTCIceServer[]` | Custom STUN/TURN servers |
| `metered` | `object` | Metered TURN API configuration |

```typescript
// Option 1: Metered TURN (recommended)
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  metered: {
    appName: 'your-app',    // From Metered dashboard
    apiKey: 'your-key',     // API key
    region: 'us_east'       // Optional region preference
  }
});

// Option 2: Custom ICE servers
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ]
});
```

---

## Observability Options

| Option | Type | Description |
|--------|------|-------------|
| `hooks` | `ServerHooks & OrchestratorHooks` | Event callbacks for logging/monitoring |
| `metrics` | `MetricsAdapter` | Metrics adapter (Prometheus, DataDog, etc.) |

```typescript
import { createTimingHooks, ConsoleMetrics } from '@metered/llmrtc-core';

const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  hooks: createTimingHooks(),
  metrics: new ConsoleMetrics()  // For debugging
});
```

See [Hooks & Metrics](../core-sdk/hooks-and-metrics) for complete hook reference.

---

## Streaming TTS Options

| Option | Type | Description |
|--------|------|-------------|
| `streamingTTS` | `boolean` | Enable low-latency streaming (default: true) |
| `sentenceChunker` | `(text: string) => string[]` | Custom sentence boundary detection |

**Custom Sentence Chunker:**

For non-Latin languages or custom punctuation:

```typescript
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  streamingTTS: true,
  sentenceChunker: (text) => {
    // Custom logic for CJK languages
    return text.split(/[。！？]/g).filter(Boolean);
  }
});
```

---

## Complete Example

```typescript
import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider,
  ToolRegistry,
  createTimingHooks
} from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  // Required
  providers: {
    llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new ElevenLabsTTSProvider({ apiKey: process.env.ELEVENLABS_API_KEY! })
  },

  // Server
  port: 8787,
  host: '0.0.0.0',

  // Conversation
  systemPrompt: 'You are a helpful voice assistant.',
  historyLimit: 8,
  streamingTTS: true,

  // Playbook mode (optional)
  playbook: myPlaybook,
  toolRegistry: myTools,
  playbookOptions: {
    maxToolCallsPerTurn: 10,
    phase1TimeoutMs: 60000,
    llmRetries: 3,
    historyLimit: 50
  },

  // ICE servers
  metered: {
    appName: 'my-app',
    apiKey: process.env.METERED_API_KEY!
  },

  // Observability
  hooks: createTimingHooks(),

  // Heartbeat
  heartbeatTimeout: 45000
});

await server.start();
```

---

## Related

- [Environment Variables](environment-variables) - CLI/env-based configuration
- [Networking & TURN](networking-and-turn) - ICE server setup
- [Hooks & Metrics](../core-sdk/hooks-and-metrics) - Observability
