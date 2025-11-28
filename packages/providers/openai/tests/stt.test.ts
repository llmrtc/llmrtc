import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenAIWhisperProvider } from '../src/index.js';
import { createMockWhisperResponse, createTestAudioBuffer } from '../../test-utils.js';

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn(),
  toFile: vi.fn().mockImplementation(async (buffer: Buffer, filename: string) => ({
    name: filename,
    size: buffer.length,
    type: 'audio/webm'
  }))
}));

import OpenAI, { toFile } from 'openai';

describe('OpenAIWhisperProvider', () => {
  let provider: OpenAIWhisperProvider;
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreate = vi.fn();
    (OpenAI as unknown as Mock).mockImplementation(() => ({
      audio: {
        transcriptions: {
          create: mockCreate
        }
      }
    }));

    provider = new OpenAIWhisperProvider({
      apiKey: 'test-api-key',
      model: 'whisper-1'
    });
  });

  describe('constructor', () => {
    it('should use default model when not specified', () => {
      const defaultProvider = new OpenAIWhisperProvider({
        apiKey: 'test-key'
      });
      expect(defaultProvider.name).toBe('openai-whisper');
    });

    it('should pass baseURL to OpenAI client', () => {
      new OpenAIWhisperProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });
    });

    it('should store language config', () => {
      const langProvider = new OpenAIWhisperProvider({
        apiKey: 'test-key',
        language: 'es'
      });
      expect(langProvider.name).toBe('openai-whisper');
    });
  });

  describe('transcribe()', () => {
    it('should return transcribed text', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse('Hello, world!'));

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('Hello, world!');
    });

    it('should set isFinal to true', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse('Test'));

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.isFinal).toBe(true);
    });

    it('should include raw response', async () => {
      const mockResponse = createMockWhisperResponse('Test');
      mockCreate.mockResolvedValue(mockResponse);

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.raw).toBeDefined();
      expect(result.raw).toEqual(mockResponse);
    });

    it('should use toFile helper to convert buffer', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse('Test'));

      const audioBuffer = createTestAudioBuffer();
      await provider.transcribe(audioBuffer);

      expect(toFile).toHaveBeenCalledWith(
        audioBuffer,
        'audio.webm',
        { type: 'audio/webm' }
      );
    });

    it('should pass model to API', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse('Test'));

      const audioBuffer = createTestAudioBuffer();
      await provider.transcribe(audioBuffer);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'whisper-1' })
      );
    });

    it('should pass language when configured', async () => {
      const spanishProvider = new OpenAIWhisperProvider({
        apiKey: 'test-key',
        language: 'es'
      });

      mockCreate.mockResolvedValue(createMockWhisperResponse('Hola'));

      const audioBuffer = createTestAudioBuffer();
      await spanishProvider.transcribe(audioBuffer);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'es' })
      );
    });

    it('should handle empty transcription', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse(''));

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('');
    });

    it('should handle null text in response', async () => {
      mockCreate.mockResolvedValue({ text: null });

      const audioBuffer = createTestAudioBuffer();
      const result = await provider.transcribe(audioBuffer);

      expect(result.text).toBe('');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error: Invalid audio format'));

      const audioBuffer = createTestAudioBuffer();

      await expect(provider.transcribe(audioBuffer)).rejects.toThrow(
        'API Error: Invalid audio format'
      );
    });

    it('should handle rate limit errors', async () => {
      mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

      const audioBuffer = createTestAudioBuffer();

      await expect(provider.transcribe(audioBuffer)).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should work with different buffer sizes', async () => {
      mockCreate.mockResolvedValue(createMockWhisperResponse('Test'));

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
