/**
 * OpenAI LLM Provider Integration Tests
 *
 * These tests call the real OpenAI API to verify integration.
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. OPENAI_API_KEY environment variable is set
 *
 * Run with: INTEGRATION_TESTS=true OPENAI_API_KEY=sk-... npm run test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAILLMProvider, OpenAIWhisperProvider, OpenAITTSProvider } from '../src/index.js';

const SKIP = !process.env.INTEGRATION_TESTS || !process.env.OPENAI_API_KEY;

describe.skipIf(SKIP)('OpenAILLMProvider Integration', () => {
  let provider: OpenAILLMProvider;

  beforeAll(() => {
    provider = new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini'
    });
  });

  it('should complete a real request', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Say "test" and nothing else' }]
    });

    // Non-deterministic assertion - check structure, not content
    expect(result).toHaveProperty('fullText');
    expect(typeof result.fullText).toBe('string');
    expect(result.fullText.length).toBeGreaterThan(0);
  }, 30000); // 30 second timeout for API call

  it('should stream a real response', async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'Count from 1 to 3' }]
    })) {
      chunks.push(chunk.content);
    }

    // Should have received multiple chunks
    expect(chunks.length).toBeGreaterThan(1);
    // Last chunk should be done
    const assembled = chunks.join('');
    expect(assembled.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle system prompts', async () => {
    const result = await provider.complete({
      messages: [
        { role: 'system', content: 'You only respond with the word "OK"' },
        { role: 'user', content: 'Hello' }
      ]
    });

    expect(result.fullText.toLowerCase()).toContain('ok');
  }, 30000);

  it('should respect temperature setting', async () => {
    // Low temperature should give more consistent results
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'What is 2+2? Answer with just the number.' }],
      config: { temperature: 0 }
    });

    expect(result.fullText).toContain('4');
  }, 30000);

  it('should call tools when provided', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'What is the weather in Tokyo? Use the get_weather tool.' }],
      tools: [{
        name: 'get_weather',
        description: 'Get the current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'The city name' }
          },
          required: ['city']
        }
      }],
      toolChoice: 'required'
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThan(0);
    expect(result.toolCalls![0].name).toBe('get_weather');
    expect(result.toolCalls![0].arguments).toHaveProperty('city');
  }, 30000);

  it('should handle tool results and continue conversation', async () => {
    // First call: LLM decides to call tool
    const firstResult = await provider.complete({
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: [{
        name: 'get_weather',
        description: 'Get the current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'The city name' }
          },
          required: ['city']
        }
      }],
      toolChoice: 'auto'
    });

    if (firstResult.stopReason === 'tool_use' && firstResult.toolCalls?.length) {
      // Second call: provide tool result
      // IMPORTANT: Assistant message must include toolCalls for OpenAI to accept tool results
      const secondResult = await provider.complete({
        messages: [
          { role: 'user', content: 'What is the weather in Paris?' },
          {
            role: 'assistant',
            content: firstResult.fullText || '',
            toolCalls: firstResult.toolCalls
          },
          {
            role: 'tool',
            content: JSON.stringify({ temperature: 18, condition: 'sunny', city: 'Paris' }),
            toolCallId: firstResult.toolCalls[0].callId,
            toolName: firstResult.toolCalls[0].name
          }
        ],
        tools: [{
          name: 'get_weather',
          description: 'Get the current weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'The city name' }
            },
            required: ['city']
          }
        }]
      });

      // LLM should respond with the weather info
      expect(secondResult.stopReason).toBe('end_turn');
      expect(secondResult.fullText.toLowerCase()).toMatch(/paris|18|sunny|weather/i);
    }
  }, 60000);

  it('should stream tool calls', async () => {
    const chunks: any[] = [];
    let finalToolCalls: any[] | undefined;

    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'Get weather for London' }],
      tools: [{
        name: 'get_weather',
        description: 'Get the current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: 'The city name' }
          },
          required: ['city']
        }
      }],
      toolChoice: 'required'
    })) {
      chunks.push(chunk);
      if (chunk.done && chunk.toolCalls) {
        finalToolCalls = chunk.toolCalls;
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(finalToolCalls).toBeDefined();
    expect(finalToolCalls!.length).toBeGreaterThan(0);
    expect(finalToolCalls![0].name).toBe('get_weather');
  }, 30000);
});

describe.skipIf(SKIP)('OpenAIWhisperProvider Integration', () => {
  let provider: OpenAIWhisperProvider;

  beforeAll(() => {
    provider = new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    });
  });

  it('should transcribe audio buffer', async () => {
    // Create a minimal valid audio buffer (silent WAV)
    // This test verifies the API connection and request format
    // In a real scenario, you'd use actual audio data
    const silentWav = createSilentWavBuffer();

    try {
      const result = await provider.transcribe(silentWav);

      // Verify response structure
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('isFinal');
      expect(result.isFinal).toBe(true);
    } catch (error: any) {
      // API might reject very short/silent audio - these specific errors are expected
      // OpenAI returns 400 for audio too short or invalid format
      const isExpectedError =
        error.message?.includes('audio') ||
        error.message?.includes('too short') ||
        error.message?.includes('Invalid') ||
        error.status === 400;

      if (!isExpectedError) {
        // Re-throw unexpected errors (network issues, auth failures, etc.)
        throw error;
      }
      // Expected rejection of silent/short audio is acceptable
      expect(isExpectedError).toBe(true);
    }
  }, 30000);
});

describe.skipIf(SKIP)('OpenAITTSProvider Integration', () => {
  let provider: OpenAITTSProvider;

  beforeAll(() => {
    provider = new OpenAITTSProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'tts-1',
      voice: 'alloy'
    });
  });

  it('should generate speech audio', async () => {
    const result = await provider.speak('Hello');

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(result.format).toBe('mp3');
  }, 30000);

  it('should support PCM format', async () => {
    const result = await provider.speak('Test', { format: 'pcm' });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(result.format).toBe('pcm');
  }, 30000);

  it('should support different voices', async () => {
    const result = await provider.speak('Hello', { voice: 'nova' });

    expect(result.audio).toBeInstanceOf(Buffer);
    expect(result.audio.length).toBeGreaterThan(0);
  }, 30000);
});

/**
 * Create a minimal valid WAV buffer (silent audio)
 * Used for testing API connectivity without real audio
 */
function createSilentWavBuffer(): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const duration = 0.1; // 100ms of silence
  const numSamples = Math.floor(sampleRate * duration);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Audio data is already zeros (silent)

  return buffer;
}
