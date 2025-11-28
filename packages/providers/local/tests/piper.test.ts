import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { PiperTTSProvider } from '../src/index.js';
import { createTestAudioBuffer } from '../../test-utils.js';

vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

import fetch from 'node-fetch';

describe('PiperTTSProvider', () => {
  let provider: PiperTTSProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new PiperTTSProvider({
      baseUrl: 'http://localhost:5002'
    });
  });

  describe('constructor', () => {
    it('should use default baseUrl when not specified', () => {
      const defaultProvider = new PiperTTSProvider();
      expect(defaultProvider.name).toBe('piper-tts');
    });

    it('should accept custom baseUrl', () => {
      const customProvider = new PiperTTSProvider({
        baseUrl: 'http://192.168.1.100:5002'
      });
      expect(customProvider.name).toBe('piper-tts');
    });

    it('should accept voice config', () => {
      const voiceProvider = new PiperTTSProvider({
        voice: 'en_US-lessac-medium'
      });
      expect(voiceProvider.name).toBe('piper-tts');
    });
  });

  describe('speak()', () => {
    it('should return audio buffer', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Hello, world!');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it('should return wav format', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Test');

      expect(result.format).toBe('wav');
    });

    it('should call correct endpoint', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:5002/api/tts',
        expect.any(Object)
      );
    });

    it('should use POST method', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should set Content-Type header', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    it('should pass text in body', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Hello, world!');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe('Hello, world!');
    });

    it('should pass voice when configured', async () => {
      const voiceProvider = new PiperTTSProvider({
        baseUrl: 'http://localhost:5002',
        voice: 'en_US-lessac-medium'
      });

      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await voiceProvider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.voice).toBe('en_US-lessac-medium');
    });

    it('should not pass voice when not configured', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('Test');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.voice).toBeUndefined();
    });

    it('should throw on API error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      await expect(provider.speak('Test')).rejects.toThrow('piper failed: 500');
    });

    it('should include error text in thrown error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid voice')
      });

      await expect(provider.speak('Test')).rejects.toThrow('Invalid voice');
    });

    it('should throw on connection error', async () => {
      (fetch as unknown as Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(provider.speak('Test')).rejects.toThrow('ECONNREFUSED');
    });

    it('should handle empty text', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      await provider.speak('');

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe('');
    });

    it('should handle long text', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const longText = 'A'.repeat(10000);
      await provider.speak(longText);

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe(longText);
    });

    it('should handle special characters', async () => {
      const audioBuffer = createTestAudioBuffer();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const specialText = 'Hello! "How are you?" <test> & stuff';
      await provider.speak(specialText);

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.text).toBe(specialText);
    });

    it('should convert arrayBuffer to Buffer', async () => {
      const arrayBuffer = new ArrayBuffer(100);
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(arrayBuffer)
      });

      const result = await provider.speak('Test');

      expect(Buffer.isBuffer(result.audio)).toBe(true);
    });
  });
});
