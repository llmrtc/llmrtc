# @metered/llmrtc

A TypeScript SDK for building real-time voice and vision AI applications. Combines LLM, Speech-to-Text, Text-to-Speech, and vision capabilities over WebRTC for low-latency conversational AI.

## Features

- **Real-time Voice Conversations** - WebRTC-based audio streaming with server-side VAD (Voice Activity Detection)
- **Multi-Provider Support** - OpenAI, Anthropic Claude, Google Gemini, AWS Bedrock, OpenRouter, and local models
- **Vision/Multimodal** - Camera and screen capture with automatic frame extraction
- **Streaming Responses** - Stream LLM and TTS responses for minimal latency
- **Barge-in Support** - Interrupt AI responses mid-speech
- **Automatic Reconnection** - Built-in connection state management with exponential backoff
- **Session Persistence** - Maintain conversation history across reconnections

## Architecture

```
┌─────────────────┐         WebRTC          ┌─────────────────┐
│                 │◄──────────────────────►│                 │
│   Web Client    │      Audio/Data        │    Backend      │
│                 │                         │                 │
└─────────────────┘                         └────────┬────────┘
                                                     │
                                            ┌────────▼────────┐
                                            │   Orchestrator  │
                                            └────────┬────────┘
                                                     │
                      ┌──────────────┬───────────────┼───────────────┬──────────────┐
                      ▼              ▼               ▼               ▼              ▼
               ┌──────────┐  ┌──────────┐    ┌──────────┐    ┌──────────┐   ┌──────────┐
               │   LLM    │  │   STT    │    │   TTS    │    │  Vision  │   │   VAD    │
               │ Provider │  │ Provider │    │ Provider │    │ Provider │   │ (Silero) │
               └──────────┘  └──────────┘    └──────────┘    └──────────┘   └──────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@metered/llmrtc-core` | Core types, interfaces, and orchestrator |
| `@metered/llmrtc-web-client` | Browser client with WebRTC support |
| `@metered/llmrtc-backend` | Node.js backend with signaling server |

### LLM Providers

| Package | Provider | Features |
|---------|----------|----------|
| `@metered/llmrtc-provider-openai` | OpenAI | GPT-4o, Whisper STT, TTS |
| `@metered/llmrtc-provider-anthropic` | Anthropic | Claude 3.5 Sonnet/Opus, vision |
| `@metered/llmrtc-provider-google` | Google | Gemini 2.5 Flash/Pro, multimodal |
| `@metered/llmrtc-provider-bedrock` | AWS Bedrock | Claude, Nova, Llama via AWS |
| `@metered/llmrtc-provider-openrouter` | OpenRouter | Multi-model gateway |
| `@metered/llmrtc-provider-lmstudio` | LMStudio | Local model inference |
| `@metered/llmrtc-provider-local` | Local | Ollama, Faster Whisper, Piper TTS |

### TTS Providers

| Package | Provider | Features |
|---------|----------|----------|
| `@metered/llmrtc-provider-openai` | OpenAI | tts-1, tts-1-hd, streaming |
| `@metered/llmrtc-provider-elevenlabs` | ElevenLabs | High-quality voices, streaming |
| `@metered/llmrtc-provider-local` | Piper | Offline TTS |

---

## Quick Start

### Installation

```bash
# Core packages
npm install @metered/llmrtc-core @metered/llmrtc-backend @metered/llmrtc-web-client

# Choose your providers
npm install @metered/llmrtc-provider-openai @metered/llmrtc-provider-elevenlabs
```

### Backend Setup

```typescript
import { ConversationOrchestrator } from '@metered/llmrtc-core';
import { OpenAILLMProvider, OpenAIWhisperProvider } from '@metered/llmrtc-provider-openai';
import { ElevenLabsTTSProvider } from '@metered/llmrtc-provider-elevenlabs';

// Configure providers
const providers = {
  llm: new OpenAILLMProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini'
  }),
  stt: new OpenAIWhisperProvider({
    apiKey: process.env.OPENAI_API_KEY
  }),
  tts: new ElevenLabsTTSProvider({
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: '21m00Tcm4TlvDq8ikWAM'
  })
};

// Create orchestrator
const orchestrator = new ConversationOrchestrator({
  systemPrompt: 'You are a helpful voice assistant.',
  historyLimit: 8,
  providers
});

// Process a turn (audio -> transcript -> response -> speech)
for await (const item of orchestrator.runTurnStream(audioBuffer)) {
  if ('isFinal' in item) console.log('Transcript:', item.text);
  if ('done' in item) console.log('LLM chunk:', item.content);
  if ('audio' in item) console.log('TTS audio:', item.audio.length, 'bytes');
}
```

### Frontend Setup

```typescript
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787',
  iceServers: []
});

// Event handlers
client.on('transcript', (text) => console.log('You said:', text));
client.on('llmChunk', (text) => console.log('AI:', text));
client.on('ttsTrack', (stream) => {
  // Play TTS audio through WebRTC MediaStreamTrack
  const audio = new Audio();
  audio.srcObject = stream;
  audio.play();
});
client.on('stateChange', (state) => console.log('Connection:', state));

// Connect
await client.start();

// Share microphone
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
await client.shareAudio(stream);

// Optional: Share camera for vision
const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
client.shareVideo(videoStream);
```

---

## API Reference

### Core Types

#### LLMProvider

```typescript
interface LLMProvider {
  name: string;
  init?(): Promise<void>;
  complete(request: LLMRequest): Promise<LLMResult>;
  stream?(request: LLMRequest): AsyncIterable<LLMChunk>;
}

interface LLMRequest {
  messages: Message[];
  config?: SessionConfig;
  stream?: boolean;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: VisionAttachment[];
}
```

#### STTProvider

```typescript
interface STTProvider {
  name: string;
  init?(): Promise<void>;
  transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult>;
  transcribeStream?(audio: AsyncIterable<Buffer>, config?: STTConfig): AsyncIterable<STTResult>;
}
```

#### TTSProvider

```typescript
interface TTSProvider {
  name: string;
  init?(): Promise<void>;
  speak(text: string, config?: TTSConfig): Promise<TTSResult>;
  speakStream?(text: string, config?: TTSConfig): AsyncIterable<Buffer>;
}

interface TTSConfig {
  voice?: string;
  format?: 'mp3' | 'ogg' | 'wav' | 'pcm';
  model?: string;
}
```

### ConversationOrchestrator

The orchestrator manages the conversation flow: audio → STT → LLM → TTS.

```typescript
const orchestrator = new ConversationOrchestrator({
  systemPrompt: 'You are a helpful assistant.',
  historyLimit: 8,  // Number of messages to keep in context
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 1024,
  providers: {
    llm: llmProvider,
    stt: sttProvider,
    tts: ttsProvider,
    vision?: visionProvider
  }
});

// Non-streaming
const result = await orchestrator.runTurn(audioBuffer, attachments);

// Streaming (recommended)
for await (const item of orchestrator.runTurnStream(audioBuffer, attachments)) {
  // Handle STTResult, LLMChunk, LLMResult, TTSResult
}
```

### LLMRTCWebClient

Browser client for WebRTC-based communication.

```typescript
const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  reconnection: {
    enabled: true,
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 30000
  }
});

// Connection lifecycle
await client.start();
client.close();

// State
client.state; // 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed'
client.currentSessionId;

// Audio
const audioCtrl = await client.shareAudio(micStream);
await audioCtrl.stop();

// Video/Screen capture for vision
const videoCtrl = client.shareVideo(cameraStream, 1000); // 1 frame/sec
const screenCtrl = client.shareScreen(screenStream, 1200);
videoCtrl.stop();

// Events
client.on('transcript', (text) => {});
client.on('llm', (fullText) => {});
client.on('llmChunk', (chunk) => {});
client.on('tts', (audio, format) => {});
client.on('ttsTrack', (mediaStream) => {});
client.on('ttsStart', () => {});
client.on('ttsComplete', () => {});
client.on('ttsCancelled', () => {}); // Barge-in occurred
client.on('speechStart', () => {});
client.on('speechEnd', () => {});
client.on('error', (error) => {});
client.on('stateChange', (state) => {});
client.on('reconnecting', (attempt, maxAttempts) => {});
```

---

## Provider Configuration

### OpenAI

```typescript
import {
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  OpenAITTSProvider
} from '@metered/llmrtc-provider-openai';

// LLM
const llm = new OpenAILLMProvider({
  apiKey: 'sk-...',
  model: 'gpt-4o-mini', // or 'gpt-4o', 'gpt-4-turbo'
  baseURL: 'https://api.openai.com/v1' // optional
});

// STT
const stt = new OpenAIWhisperProvider({
  apiKey: 'sk-...',
  model: 'whisper-1',
  language: 'en' // optional
});

// TTS
const tts = new OpenAITTSProvider({
  apiKey: 'sk-...',
  model: 'tts-1', // or 'tts-1-hd', 'gpt-4o-mini-tts'
  voice: 'nova', // alloy, echo, fable, onyx, nova, shimmer
  speed: 1.0 // 0.25 to 4.0
});

// Streaming TTS
for await (const chunk of tts.speakStream('Hello world')) {
  // Process audio chunks as they arrive
}
```

### Anthropic Claude

```typescript
import { AnthropicLLMProvider } from '@metered/llmrtc-provider-anthropic';

const llm = new AnthropicLLMProvider({
  apiKey: 'sk-ant-...',
  model: 'claude-sonnet-4-5-20250929', // or claude-3-opus, claude-3-haiku
  maxTokens: 4096
});

// Supports vision via message attachments
const result = await llm.complete({
  messages: [{
    role: 'user',
    content: 'What is in this image?',
    attachments: [{
      data: 'data:image/jpeg;base64,...',
      mimeType: 'image/jpeg'
    }]
  }]
});
```

### Google Gemini

```typescript
import { GeminiLLMProvider } from '@metered/llmrtc-provider-google';

const llm = new GeminiLLMProvider({
  apiKey: 'AIza...',
  model: 'gemini-2.5-flash' // or 'gemini-2.5-pro'
});

// Streaming
for await (const chunk of llm.stream({ messages })) {
  console.log(chunk.content);
}
```

### AWS Bedrock

```typescript
import { BedrockLLMProvider } from '@metered/llmrtc-provider-bedrock';

const llm = new BedrockLLMProvider({
  region: 'us-east-1',
  // Uses AWS credential chain by default (env vars, ~/.aws/credentials, IAM role)
  credentials: {
    accessKeyId: '...',
    secretAccessKey: '...'
  },
  model: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
  // Also supports: amazon.nova-*, meta.llama3-*, mistral.*
});
```

### OpenRouter

```typescript
import { OpenRouterLLMProvider } from '@metered/llmrtc-provider-openrouter';

const llm = new OpenRouterLLMProvider({
  apiKey: 'sk-or-...',
  model: 'anthropic/claude-3.5-sonnet', // provider/model format
  siteUrl: 'https://myapp.com', // optional, for rankings
  siteName: 'My App'
});
```

### LMStudio (Local)

```typescript
import { LMStudioLLMProvider } from '@metered/llmrtc-provider-lmstudio';

const llm = new LMStudioLLMProvider({
  baseUrl: 'http://localhost:1234/v1',
  model: 'llama-3.2-3b' // Model loaded in LMStudio
});
```

### ElevenLabs

```typescript
import { ElevenLabsTTSProvider } from '@metered/llmrtc-provider-elevenlabs';

const tts = new ElevenLabsTTSProvider({
  apiKey: 'xi-...',
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel
  modelId: 'eleven_flash_v2_5', // Low latency
  // or 'eleven_multilingual_v2' for quality
  format: 'mp3'
});

// Streaming TTS for real-time playback
for await (const chunk of tts.speakStream('Hello world')) {
  // chunks arrive as audio is generated
}
```

### Local Providers (Ollama, Faster Whisper, Piper)

```typescript
import {
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider,
  LlavaVisionProvider
} from '@metered/llmrtc-provider-local';

// Ollama LLM
const llm = new OllamaLLMProvider({
  model: 'llama3.2',
  baseUrl: 'http://localhost:11434'
});

// Faster Whisper STT
const stt = new FasterWhisperProvider({
  baseUrl: 'http://localhost:8000'
});

// Piper TTS
const tts = new PiperTTSProvider({
  baseUrl: 'http://localhost:5000'
});

// LLaVA Vision
const vision = new LlavaVisionProvider({
  model: 'llava:7b'
});
```

---

## Backend Server

The backend package includes a ready-to-use WebRTC signaling server with VAD.

### Environment Variables

```bash
# Required for cloud providers
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=xi-...

# Optional
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
AWS_REGION=us-east-1

# Server config
PORT=8787
HOST=127.0.0.1

# For local-only mode
LOCAL_ONLY=true
FASTER_WHISPER_URL=http://localhost:8000
PIPER_URL=http://localhost:5000
```

### Running the Backend

```bash
# Development
npm run dev:backend

# Production
npm run build
node packages/backend/dist/index.js
```

### Custom Backend Configuration

```typescript
import express from 'express';
import { WebSocketServer } from 'ws';
import { ConversationOrchestrator } from '@metered/llmrtc-core';
import { NativePeerServer } from '@metered/llmrtc-backend';

const app = express();
const server = app.listen(8787);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const orchestrator = new ConversationOrchestrator({
    systemPrompt: 'Custom system prompt',
    providers: {
      llm: yourLLMProvider,
      stt: yourSTTProvider,
      tts: yourTTSProvider
    }
  });

  // Handle WebRTC signaling and audio processing
  // See packages/backend/src/index.ts for full implementation
});
```

---

## Advanced Usage

### Dynamic Provider Selection

```typescript
function createLLMProvider(): LLMProvider {
  switch (process.env.LLM_PROVIDER) {
    case 'openai':
      return new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY });
    case 'anthropic':
      return new AnthropicLLMProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
    case 'gemini':
      return new GeminiLLMProvider({ apiKey: process.env.GOOGLE_API_KEY });
    case 'bedrock':
      return new BedrockLLMProvider({ region: process.env.AWS_REGION });
    case 'openrouter':
      return new OpenRouterLLMProvider({
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL
      });
    case 'lmstudio':
      return new LMStudioLLMProvider({ baseUrl: process.env.LMSTUDIO_URL });
    default:
      return new OllamaLLMProvider({ model: process.env.OLLAMA_MODEL });
  }
}
```

### Handling Barge-in (User Interruption)

```typescript
// Frontend
client.on('speechStart', () => {
  // User started speaking - TTS will be cancelled server-side
  console.log('User interrupting...');
});

client.on('ttsCancelled', () => {
  // TTS was cancelled due to user speech
  stopCurrentAudioPlayback();
});

// Backend handles barge-in automatically via VAD
```

### Vision with Multiple Sources

```typescript
// Capture camera frames
const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
const cameraCtrl = client.shareVideo(cameraStream, 1000); // 1 FPS

// Capture screen
const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
const screenCtrl = client.shareScreen(screenStream, 1200); // 0.83 FPS

// Frames are automatically sent with speech segments
client.on('speechEnd', () => {
  // Attachments are gathered and sent automatically
});
```

### Connection State Handling

```typescript
client.on('stateChange', (state) => {
  switch (state) {
    case 'connecting':
      showSpinner();
      break;
    case 'connected':
      hideSpinner();
      enableMicrophone();
      break;
    case 'reconnecting':
      showReconnectingBanner();
      break;
    case 'failed':
      showErrorMessage('Connection failed');
      break;
    case 'closed':
      cleanup();
      break;
  }
});

client.on('reconnecting', (attempt, maxAttempts) => {
  updateBanner(`Reconnecting... (${attempt}/${maxAttempts})`);
});
```

---

## Development

### Project Structure

```
packages/
├── core/                 # Types, interfaces, orchestrator
├── backend/              # Node.js server, WebRTC, VAD
├── web-client/           # Browser client
└── providers/
    ├── openai/           # OpenAI LLM, Whisper, TTS
    ├── anthropic/        # Claude
    ├── google/           # Gemini
    ├── bedrock/          # AWS Bedrock
    ├── openrouter/       # OpenRouter gateway
    ├── lmstudio/         # LMStudio local
    ├── elevenlabs/       # ElevenLabs TTS
    └── local/            # Ollama, Faster Whisper, Piper
```

### Building

```bash
npm install
npm run build
```

### Running Examples

```bash
# Start backend
npm run dev:backend

# Start frontend (Vite demo)
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all packages |
| `npm run typecheck` | TypeScript type checking |
| `npm run dev` | Start Vite demo |
| `npm run dev:backend` | Start backend in dev mode |
| `npm run lint` | Run ESLint |
| `npm run format` | Check Prettier formatting |
| `npm test` | Run tests |

---

## Troubleshooting

### WebRTC Connection Issues

- **ICE gathering fails**: Ensure STUN/TURN servers are configured correctly
- **Connection timeout**: Check firewall settings, try with TURN relay
- **No audio**: Verify microphone permissions, check browser console

### Provider Errors

- **API key invalid**: Check environment variables are set correctly
- **Rate limits**: Implement retry logic or upgrade API tier
- **Model not found**: Verify model name matches provider's current offerings

### Backend Issues

- **wrtc module errors**: The native WebRTC module requires compatible binaries. Falls back to WebSocket-only if unavailable.
- **Missing audio**: Check TTS provider configuration and API keys
- **VAD not triggering**: Adjust microphone input level, check audio track is active

---

## Requirements

- Node.js >= 20
- TypeScript >= 5.6
- Browser with WebRTC support (Chrome, Firefox, Safari, Edge)

---

## License

MIT
