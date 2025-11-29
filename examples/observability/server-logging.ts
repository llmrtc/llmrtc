/**
 * Logging Example
 *
 * Demonstrates structured logging with timing information using
 * the built-in createLoggingHooks() factory.
 *
 * Features shown:
 * - createLoggingHooks() with configurable log levels
 * - Custom prefix for log output
 * - includePayloads option for debugging
 * - Turn-by-turn timing output
 *
 * Run: npm run dev:logging
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider,
  createLoggingHooks
} from '@metered/llmrtc-backend';

// Create structured logging hooks
// This logs all turn lifecycle events with timing
const loggingHooks = createLoggingHooks({
  level: 'info',           // 'debug' | 'info' | 'warn' | 'error'
  prefix: '[voice-app]',   // Custom log prefix
  includePayloads: true,   // Include STT text and LLM responses in logs
  includeTimestamp: true   // Include ISO timestamp
});

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
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise.',

  // Attach the logging hooks
  hooks: loggingHooks
});

// Server-level events (separate from orchestrator hooks)
server.on('listening', ({ host, port }) => {
  console.log(`\n  Logging Example Server`);
  console.log(`  ======================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client`);
  console.log(`\n  Watch the console output as you speak!\n`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

await server.start();

/**
 * Expected output when you speak:
 *
 * 2024-01-15T10:30:00.000Z [voice-app] Connection established session=abc123 connection=xyz789
 * 2024-01-15T10:30:05.000Z [voice-app] Turn started turn=turn-001 session=abc123 audioSize=48000b
 * 2024-01-15T10:30:05.150Z [voice-app] STT completed turn=turn-001 duration=142ms text="Hello there"
 * 2024-01-15T10:30:05.160Z [voice-app] LLM started turn=turn-001 messages=2
 * 2024-01-15T10:30:05.480Z [voice-app] LLM completed turn=turn-001 duration=312ms chars=156 response="Hello! How can I..."
 * 2024-01-15T10:30:05.570Z [voice-app] TTS completed turn=turn-001 duration=89ms
 * 2024-01-15T10:30:05.575Z [voice-app] Turn completed turn=turn-001 duration=543ms
 */
