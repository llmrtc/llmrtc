/**
 * Sentence Chunker Example
 *
 * Demonstrates custom sentence boundary detection for streaming TTS.
 * The chunker controls how LLM output is split into chunks for TTS.
 *
 * Features shown:
 * - Custom sentence chunker for i18n support
 * - Japanese/Chinese punctuation handling
 * - Custom boundary patterns (ellipsis, quotes)
 * - Comparison of different chunking strategies
 *
 * Run: npm run dev:chunker
 */

import { config } from 'dotenv';
config();

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider,
  createLoggingHooks
} from '@llmrtc/llmrtc-backend';

// =============================================================================
// Sentence Chunker Implementations
// =============================================================================

/**
 * Default English chunker - splits on Western punctuation
 */
function defaultChunker(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/**
 * CJK-aware chunker - handles Japanese/Chinese punctuation
 * Splits on both Western AND CJK sentence-ending marks
 */
function cjkChunker(text: string): string[] {
  // Match Western: . ! ?
  // Match Japanese: 。(period) ！(exclamation) ？(question)
  // Match Chinese: 。！？
  return text.split(/(?<=[.!?。！？])\s*/);
}

/**
 * Aggressive chunker - splits on more boundaries for faster TTS start
 * Good for conversational AI where latency matters
 */
function aggressiveChunker(text: string): string[] {
  // Split on: . ! ? , : ; and CJK equivalents
  // Also split on long pauses indicated by ... or —
  return text.split(/(?<=[.!?,;:。！？、；：…—])\s*/);
}

/**
 * Conservative chunker - only splits on definite sentence endings
 * Better for formal content where context matters
 */
function conservativeChunker(text: string): string[] {
  // Only split after punctuation followed by capital letter or CJK
  // This avoids splitting "Dr. Smith" or "U.S. Army"
  return text.split(/(?<=[.!?。！？])\s+(?=[A-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff])/);
}

/**
 * Quote-aware chunker - keeps quoted text together
 */
function quoteAwareChunker(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;

    if (char === '"' || char === '"' || char === '"') {
      inQuote = !inQuote;
    }

    // Only split if not in a quote
    if (!inQuote && /[.!?。！？]/.test(char)) {
      const next = text[i + 1];
      if (!next || /\s/.test(next)) {
        chunks.push(current.trim());
        current = '';
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter(c => c.length > 0);
}

// =============================================================================
// Demo: Show chunking in action
// =============================================================================

const sampleTexts = [
  // English
  'Hello there! How are you today? I hope you\'re doing well.',

  // Japanese
  'こんにちは！今日はいかがですか？良い一日をお過ごしください。',

  // Mixed with abbreviations
  'Dr. Smith went to the U.S. What did he find? Amazing things!',

  // With quotes
  'She said "Hello there!" and then asked "How are you?" It was nice.',

  // With ellipsis
  'Well... I\'m not sure. Let me think... Okay, I have an idea!'
];

console.log('\n  Sentence Chunker Comparison');
console.log('  ===========================\n');

for (const text of sampleTexts) {
  console.log(`  Input: "${text}"\n`);
  console.log(`    Default:      ${JSON.stringify(defaultChunker(text))}`);
  console.log(`    CJK:          ${JSON.stringify(cjkChunker(text))}`);
  console.log(`    Aggressive:   ${JSON.stringify(aggressiveChunker(text))}`);
  console.log(`    Conservative: ${JSON.stringify(conservativeChunker(text))}`);
  console.log(`    Quote-aware:  ${JSON.stringify(quoteAwareChunker(text))}`);
  console.log('');
}

// =============================================================================
// Server with custom chunker
// =============================================================================

// Choose which chunker to use based on your use case:
// - cjkChunker for multilingual apps
// - aggressiveChunker for low-latency conversational AI
// - conservativeChunker for formal/professional content
// - quoteAwareChunker for dialogue-heavy content

const selectedChunker = cjkChunker;

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

  // Custom sentence chunker for streaming TTS
  sentenceChunker: selectedChunker,

  // Add logging to see chunks being processed
  hooks: {
    ...createLoggingHooks({ level: 'debug', prefix: '[chunker-demo]' }),

    // Log each TTS chunk to see the chunking in action
    onTTSStart(ctx, text) {
      console.log(`[chunker] TTS starting for chunk: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  }
});

server.on('listening', ({ host, port }) => {
  console.log(`\n  Chunker Example Server`);
  console.log(`  ======================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Using: ${selectedChunker.name} chunker`);
  console.log(`  Open http://localhost:5173 to use the client`);
  console.log(`\n  Watch the console to see sentence chunks!\n`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

await server.start();

/**
 * When the LLM responds with "Hello! How can I help you today?", you'll see:
 *
 * [chunker-demo] LLM chunk received: turn=turn-001
 * [chunker] TTS starting for chunk: "Hello!"
 * [chunker] TTS starting for chunk: "How can I help you today?"
 *
 * With the aggressive chunker, the same response might be:
 *
 * [chunker] TTS starting for chunk: "Hello!"
 * [chunker] TTS starting for chunk: "How can I help you today?"
 *
 * This allows the TTS to start speaking "Hello!" immediately while
 * the LLM is still generating the rest of the response, reducing
 * perceived latency.
 */
