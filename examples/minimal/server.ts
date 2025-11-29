/**
 * Minimal LLMRTC Server Example
 *
 * This is the simplest possible backend setup showing:
 * - LLMRTCServer with streaming TTS
 * - Server event handlers
 * - Provider configuration
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider
} from '@metered/llmrtc-backend';

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
    })
  },
  port: 8787,
  streamingTTS: true,
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise and conversational.'
});

// Server event handlers
server.on('listening', ({ host, port }) => {
  console.log(`\n  Minimal LLMRTC Server`);
  console.log(`  =====================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client\n`);
});

server.on('connection', ({ id }) => {
  console.log(`[server] Client connected: ${id}`);
});

server.on('disconnect', ({ id }) => {
  console.log(`[server] Client disconnected: ${id}`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

// Start the server
await server.start();
