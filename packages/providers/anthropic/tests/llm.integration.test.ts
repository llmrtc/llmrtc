/**
 * Anthropic LLM Provider Integration Tests
 *
 * These tests call the real Anthropic API to verify integration.
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. ANTHROPIC_API_KEY environment variable is set
 *
 * Run with: INTEGRATION_TESTS=true ANTHROPIC_API_KEY=sk-ant-... npm run test
 */
import { describe, it, expect } from 'vitest';
import { AnthropicLLMProvider } from '../src/index.js';

const SKIP = !process.env.INTEGRATION_TESTS || !process.env.ANTHROPIC_API_KEY;

describe.skipIf(SKIP)('AnthropicLLMProvider Integration', () => {
  const provider = new AnthropicLLMProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-5-20250929'
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
});
