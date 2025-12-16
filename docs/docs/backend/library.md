---
title: Library Mode
---

Library mode lets you embed the LLMRTC server in your own Node.js application, giving you full control over routing, authentication, middleware, and integration.

---

## Basic Setup

```typescript
import { LLMRTCServer } from '@llmrtc/llmrtc-backend';
import { OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-5.2-chat-latest'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new OpenAITTSProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      voice: 'nova'
    })
  },
  systemPrompt: 'You are a helpful voice assistant.',
  port: 8787
});

await server.start();
```

---

## LLMRTCServer API

### Constructor Options

```typescript
interface LLMRTCServerConfig {
  // Required
  providers: {
    llm: LLMProvider;
    stt: STTProvider;
    tts: TTSProvider;
    vision?: VisionProvider;  // Optional
  };

  // Server
  port?: number;              // Default: 8787
  host?: string;              // Default: '127.0.0.1'
  cors?: CorsOptions;         // CORS configuration

  // Conversation
  systemPrompt?: string;      // System instructions
  historyLimit?: number;      // Default: 8

  // Audio
  streamingTTS?: boolean;     // Default: true
  sentenceChunker?: (text: string) => string[];  // Custom chunker

  // WebRTC
  iceServers?: RTCIceServer[];  // Custom ICE servers
  metered?: {                   // Metered.ca TURN
    appName: string;
    apiKey: string;
    region?: string;
  };

  // Playbooks
  playbook?: Playbook;
  toolRegistry?: ToolRegistry;
  playbookOptions?: PlaybookOptions;

  // Observability
  hooks?: ServerHooks;
  metrics?: MetricsAdapter;
}
```

### Methods

| Method | Description |
|--------|-------------|
| `start()` | Start the server, returns Promise |
| `stop()` | Stop the server gracefully |
| `getApp()` | Get the underlying Express app for custom routes |

### Events

The server emits Node.js EventEmitter events for connection lifecycle:

```typescript
server.on('listening', ({ host, port }) => {
  console.log(`Server running at ${host}:${port}`);
});

server.on('connection', ({ id }) => {
  console.log(`New connection: ${id}`);
});

server.on('disconnect', ({ id }) => {
  console.log(`Disconnected: ${id}`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});
```

:::note Speech Events
Speech events (`speechStart`, `speechEnd`) are **hooks**, not EventEmitter events. Pass them via the `hooks` configuration option. See [Observability & Hooks](observability-and-hooks).
:::

---

## Custom Routes

Access the Express app to add custom HTTP endpoints:

```typescript
const server = new LLMRTCServer({ /* config */ });
const app = server.getApp();

// Add REST endpoints
app.get('/api/sessions', (req, res) => {
  // Return session data
  res.json({ sessions: [] });
});

app.post('/api/sessions/:id/message', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  // Inject text message into session
  res.json({ ok: true });
});

await server.start();
```

---

## Authentication

The server doesn't include authentication—add it in your application:

### Middleware Approach

```typescript
import { LLMRTCServer } from '@llmrtc/llmrtc-backend';
import { verifyJWT } from './auth';

const server = new LLMRTCServer({ /* config */ });
const app = server.getApp();

// Auth middleware for all routes
app.use(async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await verifyJWT(token);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

await server.start();
```

### WebSocket Authentication

For WebSocket connections, validate in the upgrade handler or use a pre-auth flow:

```typescript
// Option 1: Token in query string
// Client: ws://localhost:8787?token=eyJ...

// Option 2: Pre-auth endpoint
app.post('/api/auth/ws-ticket', async (req, res) => {
  const user = req.user;
  const ticket = await createOneTimeTicket(user.id);
  res.json({ ticket });
});

// Client connects with ticket, server validates on first message
```

---

## Provider Configuration

### Mixed Providers

```typescript
import {
  AnthropicLLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider
} from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-sonnet-4-5-20250929'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: 'pNInz6obpgDQGcFmaJgB'  // Adam
    })
  }
});
```

### Local Providers

```typescript
import {
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OllamaLLMProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3'
    }),
    stt: new FasterWhisperProvider({
      baseUrl: 'http://localhost:9000'
    }),
    tts: new PiperTTSProvider({
      baseUrl: 'http://localhost:5002'
    })
  }
});
```

### Auto-Detection

```typescript
import { createProvidersFromEnv } from '@llmrtc/llmrtc-backend';

// Automatically select providers based on available env vars
const providers = createProvidersFromEnv();

const server = new LLMRTCServer({ providers });
```

---

## Hooks and Observability

```typescript
import { createLoggingHooks } from '@llmrtc/llmrtc-core';

const server = new LLMRTCServer({
  providers,
  hooks: {
    ...createLoggingHooks(),
    onConnection: (sessionId, connectionId) => {
      analytics.track('session_start', { sessionId });
    },
    onDisconnect: (sessionId, timing) => {
      analytics.track('session_end', {
        sessionId,
        duration: timing.durationMs
      });
    }
  }
});
```

See [Observability & Hooks](observability-and-hooks) for complete hook reference.

---

## Metrics Integration

```typescript
import { MetricsAdapter } from '@llmrtc/llmrtc-core';
import { PrometheusClient } from 'prom-client';

class PrometheusMetrics implements MetricsAdapter {
  private counters = new Map<string, Counter>();
  private histograms = new Map<string, Histogram>();

  increment(name: string, value = 1, tags?: Record<string, string>) {
    // Implementation
  }

  timing(name: string, valueMs: number, tags?: Record<string, string>) {
    // Implementation
  }

  gauge(name: string, value: number, tags?: Record<string, string>) {
    // Implementation
  }
}

const server = new LLMRTCServer({
  providers,
  metrics: new PrometheusMetrics()
});
```

---

## TURN Configuration

```typescript
// Using Metered.ca
const server = new LLMRTCServer({
  providers,
  metered: {
    appName: 'your-app',
    apiKey: process.env.METERED_API_KEY!,
    region: 'global'  // or specific region
  }
});

// Using custom ICE servers
const server = new LLMRTCServer({
  providers,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'user',
      credential: 'password'
    }
  ]
});
```

---

## Graceful Shutdown

```typescript
const server = new LLMRTCServer({ /* config */ });

await server.start();

// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await server.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await server.stop();
  process.exit(0);
});
```

---

## Related Documentation

- [CLI Mode](cli) - Simpler command-line usage
- [Configuration](configuration) - All configuration options
- [Voice Playbook Mode](voice-playbook) - Multi-stage conversations
- [Observability & Hooks](observability-and-hooks) - Monitoring and debugging
- [Security](security) - Authentication patterns
