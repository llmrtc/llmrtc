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
});
