/**
 * Local-Only LLMRTC Server Example
 *
 * Run a voice AI assistant entirely on your local machine.
 * No cloud API keys required!
 *
 * Prerequisites:
 * - Ollama running with a model (ollama pull llama3.2)
 * - Faster-Whisper server (docker-compose up faster-whisper)
 * - Piper TTS server (docker-compose up piper)
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider
} from '@metered/llmrtc-backend';

// Check for local services
async function checkService(name: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\n  Local-Only LLMRTC Server');
  console.log('  ========================');
  console.log('  Running entirely on your local machine!\n');

  // Check prerequisites
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const whisperUrl = process.env.FASTER_WHISPER_URL || 'http://localhost:8000';
  const piperUrl = process.env.PIPER_URL || 'http://localhost:5000';

  console.log('  Checking local services...');

  const ollamaOk = await checkService('Ollama', ollamaUrl);
  const whisperOk = await checkService('Faster-Whisper', `${whisperUrl}/health`);
  const piperOk = await checkService('Piper', piperUrl);

  console.log(`    Ollama (${ollamaUrl}): ${ollamaOk ? 'OK' : 'NOT RUNNING'}`);
  console.log(`    Faster-Whisper (${whisperUrl}): ${whisperOk ? 'OK' : 'NOT RUNNING'}`);
  console.log(`    Piper (${piperUrl}): ${piperOk ? 'OK' : 'NOT RUNNING'}`);

  if (!ollamaOk || !whisperOk || !piperOk) {
    console.log('\n  Some services are not running!');
    console.log('  Run: npm run docker:up (for Whisper & Piper)');
    console.log('  And: ollama serve (for Ollama)\n');
    process.exit(1);
  }

  console.log('\n  All services running!\n');

  const server = new LLMRTCServer({
    providers: {
      llm: new OllamaLLMProvider({
        baseUrl: ollamaUrl,
        model: process.env.OLLAMA_MODEL || 'llama3.2'
      }),
      stt: new FasterWhisperProvider({
        baseUrl: whisperUrl
      }),
      tts: new PiperTTSProvider({
        baseUrl: piperUrl
      })
    },
    port: 8787,
    streamingTTS: true,
    systemPrompt: `You are a helpful local AI assistant running entirely on this machine.
You value privacy and efficiency. Keep responses concise and helpful.`
  });

  server.on('listening', ({ host, port }) => {
    console.log(`  Server running at http://${host}:${port}`);
    console.log(`  Open http://localhost:5173 to use the client`);
    console.log('\n  Providers:');
    console.log(`    LLM: Ollama (${process.env.OLLAMA_MODEL || 'llama3.2'})`);
    console.log('    STT: Faster-Whisper');
    console.log('    TTS: Piper\n');
  });

  server.on('connection', ({ id }) => {
    console.log(`[server] Client connected: ${id}`);
  });

  server.on('disconnect', ({ id }) => {
    console.log(`[server] Client disconnected: ${id}`);
  });

  await server.start();
}

main().catch(console.error);
