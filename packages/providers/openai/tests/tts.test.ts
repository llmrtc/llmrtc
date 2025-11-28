import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenAITTSProvider } from '../src/index.js';
import { createTestAudioBuffer, createMockReadableStream } from '../../test-utils.js';

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn(),
  toFile: vi.fn()
}));

import OpenAI from 'openai';

describe('OpenAITTSProvider', () => {
  let provider: OpenAITTSProvider;
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreate = vi.fn();
    (OpenAI as unknown as Mock).mockImplementation(() => ({
      audio: {
        speech: {
          create: mockCreate
        }
      }
    }));

    provider = new OpenAITTSProvider({
      apiKey: 'test-api-key',
      model: 'tts-1',
      voice: 'alloy'
    });
  });

  describe('constructor', () => {
    it('should use default values when not specified', () => {
      const defaultProvider = new OpenAITTSProvider({
        apiKey: 'test-key'
      });
      expect(defaultProvider.name).toBe('openai-tts');
    });

    it('should pass baseURL to OpenAI client', () => {
      new OpenAITTSProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });
    });

    it('should accept all valid voice options', () => {
      const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
      for (const voice of voices) {
        const voiceProvider = new OpenAITTSProvider({
          apiKey: 'test-key',
          voice
        });
        expect(voiceProvider.name).toBe('openai-tts');
      }
    });

    it('should accept all valid model options', () => {
      const models = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const;
      for (const model of models) {
        const modelProvider = new OpenAITTSProvider({
          apiKey: 'test-key',
          model
        });
        expect(modelProvider.name).toBe('openai-tts');
      }
    });
  });

  describe('speak()', () => {
    it('should return audio buffer', async () => {
      const audioBuffer = createTestAudioBuffer();
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Hello, world!');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it('should return format', async () => {
      const audioBuffer = createTestAudioBuffer();
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const result = await provider.speak('Test');

      expect(result.format).toBe('mp3'); // Default format
    });

    it('should include raw response', async () => {
      const mockResponse = {
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      };
      mockCreate.mockResolvedValue(mockResponse);

      const result = await provider.speak('Test');

      expect(result.raw).toBeDefined();
    });

    it('should pass text to API', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Hello, world!');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'Hello, world!' })
      );
    });

    it('should pass model to API', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'tts-1' })
      );
    });

    it('should pass voice to API', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ voice: 'alloy' })
      );
    });

    it('should pass speed to API', async () => {
      const fastProvider = new OpenAITTSProvider({
        apiKey: 'test-key',
        speed: 1.5
      });

      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await fastProvider.speak('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 1.5 })
      );
    });

    it('should override voice with config', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test', { voice: 'nova' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ voice: 'nova' })
      );
    });

    it('should map mp3 format correctly', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test', { format: 'mp3' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'mp3' })
      );
    });

    it('should map ogg to opus format', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test', { format: 'ogg' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'opus' })
      );
    });

    it('should map pcm format correctly', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test', { format: 'pcm' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'pcm' })
      );
    });

    it('should map wav format correctly', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('Test', { format: 'wav' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'wav' })
      );
    });

    it('should return correct format in result', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      const result = await provider.speak('Test', { format: 'pcm' });

      expect(result.format).toBe('pcm');
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error: 401 Unauthorized'));

      await expect(provider.speak('Test')).rejects.toThrow(
        'API Error: 401 Unauthorized'
      );
    });

    it('should handle rate limit errors', async () => {
      mockCreate.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(provider.speak('Test')).rejects.toThrow(
        'Rate limit exceeded'
      );
    });

    it('should handle empty text', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      await provider.speak('');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: '' })
      );
    });

    it('should handle long text', async () => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer())
      });

      const longText = 'A'.repeat(10000);
      await provider.speak(longText);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ input: longText })
      );
    });
  });

  describe('speakStream()', () => {
    it('should yield audio chunks', async () => {
      const chunk1 = createTestAudioBuffer(1000);
      const chunk2 = createTestAudioBuffer(1000);
      mockCreate.mockResolvedValue({
        body: createMockReadableStream([chunk1, chunk2])
      });

      const chunks: Buffer[] = [];
      for await (const chunk of provider.speakStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toBeInstanceOf(Buffer);
      expect(chunks[1]).toBeInstanceOf(Buffer);
    });

    it('should pass correct params to streaming request', async () => {
      mockCreate.mockResolvedValue({
        body: createMockReadableStream([createTestAudioBuffer()])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test')) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          input: 'Test',
          model: 'tts-1',
          voice: 'alloy'
        })
      );
    });

    it('should override voice in streaming', async () => {
      mockCreate.mockResolvedValue({
        body: createMockReadableStream([createTestAudioBuffer()])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test', { voice: 'shimmer' })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ voice: 'shimmer' })
      );
    });

    it('should pass format to streaming request', async () => {
      mockCreate.mockResolvedValue({
        body: createMockReadableStream([createTestAudioBuffer()])
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.speakStream('Test', { format: 'pcm' })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'pcm' })
      );
    });

    it('should fallback to full buffer when no body reader', async () => {
      const audioBuffer = createTestAudioBuffer();
      mockCreate.mockResolvedValue({
        body: null,
        arrayBuffer: () => Promise.resolve(audioBuffer)
      });

      const chunks: Buffer[] = [];
      for await (const chunk of provider.speakStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].length).toBe(audioBuffer.length);
    });

    it('should handle empty stream', async () => {
      mockCreate.mockResolvedValue({
        body: createMockReadableStream([])
      });

      const chunks: Buffer[] = [];
      for await (const chunk of provider.speakStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(0);
    });

    it('should propagate streaming errors', async () => {
      mockCreate.mockRejectedValue(new Error('Streaming failed'));

      await expect(async () => {
        for await (const _ of provider.speakStream('Test')) {
          // consume stream
        }
      }).rejects.toThrow('Streaming failed');
    });
  });
});
