/**
 * Multi-Provider LLMRTC Server Example
 *
 * Demonstrates how to configure and switch between different providers.
 * Shows the provider factory pattern for runtime configuration.
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  // LLM Providers
  OpenAILLMProvider,
  AnthropicLLMProvider,
  GeminiLLMProvider,
  OllamaLLMProvider,
  OpenRouterLLMProvider,
  BedrockLLMProvider,
  LMStudioLLMProvider,
  // STT Providers
  OpenAIWhisperProvider,
  FasterWhisperProvider,
  // TTS Providers
  OpenAITTSProvider,
  ElevenLabsTTSProvider,
  PiperTTSProvider,
  // Types
  type LLMProvider,
  type STTProvider,
  type TTSProvider
} from '@llmrtc/llmrtc-backend';

// =============================================================================
// Provider Factories
// =============================================================================

type ProviderFactory<T> = {
  name: string;
  available: boolean;
  create: () => T;
};

// LLM Providers
const llmProviders: Record<string, ProviderFactory<LLMProvider>> = {
  openai: {
    name: 'OpenAI GPT-4o',
    available: !!process.env.OPENAI_API_KEY,
    create: () => new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    })
  },
  anthropic: {
    name: 'Anthropic Claude',
    available: !!process.env.ANTHROPIC_API_KEY,
    create: () => new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
    })
  },
  gemini: {
    name: 'Google Gemini',
    available: !!process.env.GOOGLE_API_KEY,
    create: () => new GeminiLLMProvider({
      apiKey: process.env.GOOGLE_API_KEY!,
      model: process.env.GOOGLE_MODEL || 'gemini-2.5-flash'
    })
  },
  openrouter: {
    name: 'OpenRouter',
    available: !!process.env.OPENROUTER_API_KEY,
    create: () => new OpenRouterLLMProvider({
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'
    })
  },
  bedrock: {
    name: 'AWS Bedrock',
    available: !!process.env.AWS_ACCESS_KEY_ID,
    create: () => new BedrockLLMProvider({
      region: process.env.AWS_REGION || 'us-east-1',
      model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    })
  },
  lmstudio: {
    name: 'LM Studio',
    available: true, // Always available if server is running
    create: () => new LMStudioLLMProvider({
      baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1'
    })
  },
  ollama: {
    name: 'Ollama',
    available: true, // Always available if server is running
    create: () => new OllamaLLMProvider({
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.2'
    })
  }
};

// STT Providers
const sttProviders: Record<string, ProviderFactory<STTProvider>> = {
  openai: {
    name: 'OpenAI Whisper',
    available: !!process.env.OPENAI_API_KEY,
    create: () => new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    })
  },
  'faster-whisper': {
    name: 'Faster-Whisper (Local)',
    available: true,
    create: () => new FasterWhisperProvider({
      baseUrl: process.env.FASTER_WHISPER_URL || 'http://localhost:8000'
    })
  }
};

// TTS Providers
const ttsProviders: Record<string, ProviderFactory<TTSProvider>> = {
  elevenlabs: {
    name: 'ElevenLabs',
    available: !!process.env.ELEVENLABS_API_KEY,
    create: () => new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
    })
  },
  openai: {
    name: 'OpenAI TTS',
    available: !!process.env.OPENAI_API_KEY,
    create: () => new OpenAITTSProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      voice: (process.env.OPENAI_TTS_VOICE as any) || 'nova'
    })
  },
  piper: {
    name: 'Piper (Local)',
    available: true,
    create: () => new PiperTTSProvider({
      baseUrl: process.env.PIPER_URL || 'http://localhost:5000'
    })
  }
};

// =============================================================================
// Provider Selection
// =============================================================================

function getSelectedProviders(llmKey: string, sttKey: string, ttsKey: string) {
  const llm = llmProviders[llmKey] ?? llmProviders.openai;
  const stt = sttProviders[sttKey] ?? sttProviders.openai;
  const tts = ttsProviders[ttsKey] ?? ttsProviders.elevenlabs;

  return {
    llm: llm.create(),
    stt: stt.create(),
    tts: tts.create()
  };
}

function getAvailableProviders() {
  return {
    llm: Object.entries(llmProviders).map(([key, p]) => ({
      key,
      name: p.name,
      available: p.available
    })),
    stt: Object.entries(sttProviders).map(([key, p]) => ({
      key,
      name: p.name,
      available: p.available
    })),
    tts: Object.entries(ttsProviders).map(([key, p]) => ({
      key,
      name: p.name,
      available: p.available
    }))
  };
}

// =============================================================================
// Server Setup
// =============================================================================

// Get initial provider selection from env or defaults
const initialLLM = process.env.LLM_PROVIDER || 'openai';
const initialSTT = process.env.STT_PROVIDER || 'openai';
const initialTTS = process.env.TTS_PROVIDER || 'elevenlabs';

const server = new LLMRTCServer({
  providers: getSelectedProviders(initialLLM, initialSTT, initialTTS),
  port: 8787,
  streamingTTS: true,
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise.'
});

// Add API routes for provider info
const app = server.getApp();

// GET /api/providers - List all available providers
app?.get('/api/providers', (_req, res) => {
  res.json(getAvailableProviders());
});

// GET /api/providers/current - Get current provider selection
app?.get('/api/providers/current', (_req, res) => {
  res.json({
    llm: initialLLM,
    stt: initialSTT,
    tts: initialTTS
  });
});

// Server events
server.on('listening', ({ host, port }) => {
  console.log('\n  Multi-Provider LLMRTC Server');
  console.log('  ============================');
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client\n`);

  console.log('  Current Providers:');
  console.log(`    LLM: ${llmProviders[initialLLM]?.name || initialLLM}`);
  console.log(`    STT: ${sttProviders[initialSTT]?.name || initialSTT}`);
  console.log(`    TTS: ${ttsProviders[initialTTS]?.name || initialTTS}`);

  console.log('\n  Available Providers:');
  const available = getAvailableProviders();
  console.log(`    LLM: ${available.llm.filter(p => p.available).map(p => p.key).join(', ')}`);
  console.log(`    STT: ${available.stt.filter(p => p.available).map(p => p.key).join(', ')}`);
  console.log(`    TTS: ${available.tts.filter(p => p.available).map(p => p.key).join(', ')}\n`);

  console.log('  API Endpoints:');
  console.log('    GET /api/providers - List all providers');
  console.log('    GET /api/providers/current - Get current selection\n');
});

server.on('connection', ({ id }) => {
  console.log(`[server] Client connected: ${id}`);
});

server.on('disconnect', ({ id }) => {
  console.log(`[server] Client disconnected: ${id}`);
});

await server.start();
