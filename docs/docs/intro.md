---
title: Welcome to LLMRTC
slug: /
---

**LLMRTC** is a TypeScript SDK for building real-time voice and vision AI applications. It combines WebRTC for low-latency audio/video streaming with LLMs, speech-to-text, and text-to-speech—all through a unified, provider-agnostic API.

---

## What is LLMRTC?

LLMRTC handles the complex infrastructure needed for conversational AI:

```mermaid
flowchart LR
    subgraph Browser
        MIC[Microphone] --> CLIENT[Web Client]
        CAM[Camera] --> CLIENT
        CLIENT --> SPEAKER[Speaker]
    end

    subgraph Your Server
        CLIENT <-->|WebRTC| BACKEND[LLMRTC Backend]
        BACKEND --> VAD[VAD]
        VAD --> ORCH[Orchestrator]
    end

    subgraph AI Providers
        ORCH --> STT[Speech-to-Text]
        ORCH --> LLM[Language Model]
        ORCH --> TTS[Text-to-Speech]
    end
```

You focus on your application logic. LLMRTC handles:
- Real-time audio/video streaming via WebRTC
- Voice activity detection and barge-in
- Provider orchestration and streaming pipelines
- Session management and reconnection

---

## Key Features

### Real-Time Voice
Stream audio bidirectionally with sub-second latency. Server-side VAD detects speech boundaries, and barge-in lets users interrupt the assistant naturally.

### Vision Support
Send camera frames or screen captures alongside speech. Vision-capable models can see what users see.

### Provider Agnostic
Switch between OpenAI, Anthropic, Google Gemini, AWS Bedrock, or local models without changing your code. Mix providers freely (e.g., Claude for LLM, Whisper for STT, ElevenLabs for TTS).

### Tool Calling
Define tools with JSON Schema. The model calls them, you execute them, and the conversation continues seamlessly.

### Playbooks
Build multi-stage conversations with per-stage prompts, tools, and transitions. Perfect for support bots, booking flows, and guided workflows.

### Streaming Pipeline
Responses start playing before generation completes. STT → LLM → TTS streams end-to-end for the lowest possible latency.

---

## Architecture

LLMRTC consists of three packages:

```mermaid
flowchart TB
    subgraph Packages
        CORE["llmrtc-core"]
        BACKEND["llmrtc-backend"]
        WEB["llmrtc-web-client"]
    end

    subgraph core["llmrtc-core"]
        TYPES[Types & Interfaces]
        ORCH_CORE[Orchestrators]
        TOOLS[Tool System]
        HOOKS[Hooks & Metrics]
    end

    subgraph backend["llmrtc-backend"]
        SERVER[LLMRTCServer]
        PROVIDERS[All Providers]
        WEBRTC[WebRTC Handler]
        VADPROC[VAD Processor]
    end

    subgraph webclient["llmrtc-web-client"]
        CLIENT[LLMRTCWebClient]
        SIGNALING[Signaling]
        MEDIA[Media Capture]
    end

    BACKEND --> CORE
    WEB --> CORE
```

| Package | Purpose |
|---------|---------|
| `@metered/llmrtc-core` | Types, orchestrators, tools, hooks—shared foundation |
| `@metered/llmrtc-backend` | Node.js server with WebRTC, VAD, and all providers |
| `@metered/llmrtc-web-client` | Browser SDK for audio/video capture and playback |

---

## Supported Providers

### Cloud Providers

| Provider | LLM | STT | TTS | Vision |
|----------|-----|-----|-----|--------|
| OpenAI | GPT-4o, GPT-4 | Whisper | TTS-1, TTS-1-HD | GPT-4o |
| Anthropic | Claude 3.5, Claude 3 | - | - | Claude 3 |
| Google Gemini | Gemini 1.5, Gemini Pro | - | - | Gemini Vision |
| AWS Bedrock | Claude, Llama, etc. | - | - | varies |
| OpenRouter | 100+ models | - | - | varies |
| ElevenLabs | - | - | Multilingual v2 | - |

### Local Providers

| Provider | LLM | STT | TTS | Vision |
|----------|-----|-----|-----|--------|
| Ollama | Llama, Mistral, etc. | - | - | LLaVA |
| LM Studio | Any GGUF model | - | - | - |
| Faster-Whisper | - | Whisper (fast) | - | - |
| Piper | - | - | Many voices | - |

---

## Use Cases

### Voice Assistants
Build Siri/Alexa-style assistants with custom capabilities. Add tools for your domain—check orders, book appointments, control devices.

### Customer Support
Multi-stage playbooks guide conversations through authentication, triage, and resolution. Tools integrate with your CRM and ticketing systems.

### Multimodal Agents
Combine voice with vision for screen-aware assistants. Users can share their screen or camera and ask questions about what they see.

### On-Device AI
Run entirely locally with Ollama, Faster-Whisper, and Piper. No cloud dependencies, no API costs, full privacy.

---

## Quick Example

**Backend (Node.js):**

```typescript
import { LLMRTCServer, OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new OpenAITTSProvider({ apiKey: process.env.OPENAI_API_KEY! })
  },
  systemPrompt: 'You are a helpful voice assistant.'
});

await server.start();
```

**Frontend (Browser):**

```typescript
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787'
});

client.on('transcript', (text) => console.log('User:', text));
client.on('llmChunk', (chunk) => console.log('Assistant:', chunk));

await client.start();
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
await client.shareAudio(stream);
```

---

## Getting Started

Ready to build? Follow our quickstart guides:

1. **[Installation](getting-started/installation)** - Set up packages and dependencies
2. **[Backend Quickstart](getting-started/backend-quickstart)** - Run your first server
3. **[Web Client Quickstart](getting-started/web-client-quickstart)** - Connect from the browser
4. **[Tool Calling](getting-started/tool-calling-quickstart)** - Add custom capabilities
5. **[Local-Only Stack](getting-started/local-only-stack)** - Run without cloud APIs

---

## Documentation Structure

| Section | Contents |
|---------|----------|
| **Getting Started** | Installation, quickstarts, first application |
| **Concepts** | Architecture, streaming, VAD, playbooks, tools |
| **Backend** | Server configuration, deployment, security |
| **Web Client** | Browser SDK, audio/video, UI patterns |
| **Playbooks** | Multi-stage conversations, text and voice agents |
| **Providers** | Provider-specific configuration and features |
| **Recipes** | Complete examples for common use cases |
| **Operations** | Monitoring, troubleshooting, scaling |
| **Protocol** | Wire protocol for custom clients |

---

## Community

- **GitHub**: [github.com/metered/llmrtc](https://github.com/metered/llmrtc)
- **Issues**: [Report bugs and request features](https://github.com/metered/llmrtc/issues)

---

## Next Steps

<div className="row">
  <div className="col col--6">
    <a href="getting-started/overview" className="card">
      <strong>Getting Started</strong>
      <p>Build your first voice assistant in minutes</p>
    </a>
  </div>
  <div className="col col--6">
    <a href="concepts/architecture" className="card">
      <strong>Architecture</strong>
      <p>Understand how LLMRTC works</p>
    </a>
  </div>
</div>
