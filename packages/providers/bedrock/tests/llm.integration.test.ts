/**
 * AWS Bedrock LLM Provider Integration Tests
 *
 * These tests call the real AWS Bedrock API to verify integration.
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are set
 *
 * Note: Some models (like Claude 3.5 Sonnet v2) require an inference profile for
 * on-demand throughput. Set BEDROCK_MODEL to an inference profile ARN or use a
 * model that supports on-demand (like Claude 3 Haiku).
 *
 * Run with: INTEGRATION_TESTS=true AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... npm run test
 */
import { describe, it, expect } from 'vitest';
import { BedrockLLMProvider } from '../src/index.js';

const SKIP =
  !process.env.INTEGRATION_TESTS ||
  !process.env.AWS_ACCESS_KEY_ID ||
  !process.env.AWS_SECRET_ACCESS_KEY;

describe.skipIf(SKIP)('BedrockLLMProvider Integration', () => {
  // Use Claude 3 Haiku for on-demand testing (doesn't require inference profile)
  // Or set BEDROCK_MODEL to an inference profile ARN for newer models
  const provider = new BedrockLLMProvider({
    region: process.env.AWS_REGION || 'us-east-1',
    model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'
  });

  it('should complete a real request', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Say "test" and nothing else' }]
    });

    expect(result).toHaveProperty('fullText');
    expect(typeof result.fullText).toBe('string');
    expect(result.fullText.length).toBeGreaterThan(0);
  }, 30000);

  it('should stream a real response', async () => {
    const chunks: string[] = [];

    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'Count from 1 to 3' }]
    })) {
      chunks.push(chunk.content);
    }

    expect(chunks.length).toBeGreaterThan(1);
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
      // IMPORTANT: Assistant message must include toolCalls for proper message flow
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
