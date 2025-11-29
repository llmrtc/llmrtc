# Minimal LLMRTC Example

The simplest possible example showing core event handling with streaming TTS.

## What This Demonstrates

- **Backend (`server.ts`)**: LLMRTCServer setup with streaming TTS enabled
- **Frontend (`client/main.tsx`)**: Event handling for transcript, LLM, and TTS events
- **Total**: ~80 lines of code for a complete voice AI application

## Features

- Real-time speech-to-text transcription
- Streaming LLM responses
- Text-to-speech via WebRTC audio track
- Visual status indicator (listening/thinking/speaking)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run the example:**
   ```bash
   npm run dev
   ```

4. **Open browser:**
   - Frontend: http://localhost:5173
   - Backend: http://localhost:8787/health

## Code Highlights

### Backend (server.ts)

```typescript
const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    stt: new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    tts: new ElevenLabsTTSProvider({ apiKey: process.env.ELEVENLABS_API_KEY! })
  },
  streamingTTS: true,
  systemPrompt: 'You are a helpful voice assistant.'
});

server.on('connection', ({ id }) => console.log(`Client connected: ${id}`));
await server.start();
```

### Frontend (client/main.tsx)

```typescript
const client = new LLMRTCWebClient({ signallingUrl: 'ws://localhost:8787' });

// Core events
client.on('speechStart', () => setStatus('listening'));
client.on('transcript', (text) => setTranscript(text));
client.on('llmChunk', (chunk) => setResponse(prev => prev + chunk));
client.on('ttsStart', () => setStatus('speaking'));
client.on('ttsTrack', (stream) => { audio.srcObject = stream; audio.play(); });

await client.start();
await client.shareAudio(await navigator.mediaDevices.getUserMedia({ audio: true }));
```

## Event Flow

```
User speaks → speechStart → speechEnd → transcript → llmChunk (streaming) → ttsStart → ttsTrack → ttsComplete
```

## Requirements

- Node.js 20+
- OpenAI API key
- ElevenLabs API key
