import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { FasterWhisperProvider } from '../src/index.js';
import { createTestAudioBuffer } from '../../test-utils.js';

vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

vi.mock('form-data', () => ({
  default: vi.fn().mockImplementation(() => ({
    append: vi.fn()
  }))
}));

import fetch from 'node-fetch';
import FormData from 'form-data';

describe('FasterWhisperProvider', () => {
  let provider: FasterWhisperProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new FasterWhisperProvider({
      baseUrl: 'http://localhost:9000'
    });
  });

  describe('constructor', () => {
    it('should use default baseUrl (http://localhost:9000) when not specified', async () => {
      const defaultProvider = new FasterWhisperProvider();
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      const audioBuffer = createTestAudioBuffer();
      await defaultProvider.transcribe(audioBuffer);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:9000/asr',
        expect.any(Object)
      );
    });

    it('should use custom baseUrl when specified', async () => {
      const customProvider = new FasterWhisperProvider({
        baseUrl: 'http://192.168.1.100:9000'
      });
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      const audioBuffer = createTestAudioBuffer();
      await customProvider.transcribe(audioBuffer);

      expect(fetch).toHaveBeenCalledWith(
        'http://192.168.1.100:9000/asr',
        expect.any(Object)
      );
    });

    it('should pass language config in FormData when specified', async () => {
      const langProvider = new FasterWhisperProvider({
        language: 'es'
      });
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Hola' })
      });

      const audioBuffer = createTestAudioBuffer();
      await langProvider.transcribe(audioBuffer);

      const formDataInstance = (FormData as unknown as Mock).mock.results[0].value;
      expect(formDataInstance.append).toHaveBeenCalledWith('language', 'es');
    });

    it('should pass model config in FormData when specified', async () => {
      const modelProvider = new FasterWhisperProvider({
        model: 'large-v3'
      });
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      const audioBuffer = createTestAudioBuffer();
      await modelProvider.transcribe(audioBuffer);

      const formDataInstance = (FormData as unknown as Mock).mock.results[0].value;
      expect(formDataInstance.append).toHaveBeenCalledWith('model', 'large-v3');
    });
  });

  describe('transcribe()', () => {
    it('should return transcribed text', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Hello, world!' })
      });

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('Hello, world!');
    });

    it('should set isFinal to true', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.isFinal).toBe(true);
    });

    it('should include raw response', async () => {
      const mockResponse = { text: 'Test', duration: 1.5 };
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.raw).toEqual(mockResponse);
    });

    it('should call correct endpoint', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' })
      });

      const audioBuffer = createTestAudioBuffer();
      await provider.transcribe(audioBuffer);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:9000/asr',
        expect.any(Object)
      );
    });

    it('should use POST method', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' })
      });

      const audioBuffer = createTestAudioBuffer();
      await provider.transcribe(audioBuffer);

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should create FormData and append file', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' })
      });

      const audioBuffer = createTestAudioBuffer();
      await provider.transcribe(audioBuffer);

      expect(FormData).toHaveBeenCalled();
    });

    it('should append language when configured', async () => {
      const langProvider = new FasterWhisperProvider({
        baseUrl: 'http://localhost:9000',
        language: 'es'
      });

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Hola' })
      });

      const audioBuffer = createTestAudioBuffer();
      await langProvider.transcribe(audioBuffer);

      // FormData.append should have been called with language
      const formDataInstance = (FormData as unknown as Mock).mock.results[0].value;
      expect(formDataInstance.append).toHaveBeenCalled();
    });

    it('should append model when configured', async () => {
      const modelProvider = new FasterWhisperProvider({
        baseUrl: 'http://localhost:9000',
        model: 'large-v3'
      });

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      const audioBuffer = createTestAudioBuffer();
      await modelProvider.transcribe(audioBuffer);

      // FormData.append should have been called with model
      const formDataInstance = (FormData as unknown as Mock).mock.results[0].value;
      expect(formDataInstance.append).toHaveBeenCalled();
    });

    it('should throw on API error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      const audioBuffer = createTestAudioBuffer();

      await expect(provider.transcribe(audioBuffer)).rejects.toThrow(
        'faster-whisper failed: 500'
      );
    });

    it('should include error text in thrown error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid audio format')
      });

      const audioBuffer = createTestAudioBuffer();

      await expect(provider.transcribe(audioBuffer)).rejects.toThrow(
        'Invalid audio format'
      );
    });

    it('should throw on connection error', async () => {
      (fetch as unknown as Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      const audioBuffer = createTestAudioBuffer();

      await expect(provider.transcribe(audioBuffer)).rejects.toThrow('ECONNREFUSED');
    });

    it('should handle empty transcription', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: '' })
      });

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('');
    });

    it('should work with different buffer sizes', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Test' })
      });

      // Small buffer
      const smallBuffer = createTestAudioBuffer(100);
      const result1 = await provider.transcribe(smallBuffer);
      expect(result1.text).toBe('Test');

      // Large buffer
      const largeBuffer = createTestAudioBuffer(100000);
      const result2 = await provider.transcribe(largeBuffer);
      expect(result2.text).toBe('Test');
    });
  });
});
