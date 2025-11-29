/**
 * ElevenLabs TTS Provider Integration Tests
 *
 * These tests call the real ElevenLabs API to verify integration.
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. ELEVENLABS_API_KEY environment variable is set
 *
 * Run with: INTEGRATION_TESTS=true ELEVENLABS_API_KEY=... npm run test
 */
import { describe, it, expect } from 'vitest';
import { ElevenLabsTTSProvider } from '../src/index.js';

const SKIP = !process.env.INTEGRATION_TESTS || !process.env.ELEVENLABS_API_KEY;

describe.skipIf(SKIP)('ElevenLabsTTSProvider Integration', () => {
  const provider = new ElevenLabsTTSProvider({
    apiKey: process.env.ELEVENLABS_API_KEY!,
    voiceId: '21m00Tcm4TlvDq8ikWAM' // Rachel voice
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

  it('should stream audio chunks', async () => {
    const chunks: Buffer[] = [];

    for await (const chunk of provider.speakStream('Hello world')) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
    expect(totalSize).toBeGreaterThan(0);
  }, 30000);

  it('should stream PCM audio', async () => {
    const chunks: Buffer[] = [];

    for await (const chunk of provider.speakStream('Testing', { format: 'pcm' })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
  }, 30000);
});
