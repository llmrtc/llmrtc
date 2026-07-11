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
      const voices = [
        'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
        'nova', 'onyx', 'sage', 'shimmer', 'verse'
      ] as const;
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

  describe('instructions', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(createTestAudioBuffer()),
        body: createMockReadableStream([createTestAudioBuffer()])
      });
    });

    it('sends constructor-level instructions on instructable models', async () => {
      const instructable = new OpenAITTSProvider({
        apiKey: 'k',
        model: 'gpt-4o-mini-tts',
        instructions: 'Speak calmly.'
      });

      await instructable.speak('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ instructions: 'Speak calmly.' })
      );
    });

    it('per-call instructions override constructor instructions', async () => {
      const instructable = new OpenAITTSProvider({
        apiKey: 'k',
        model: 'gpt-4o-mini-tts',
        instructions: 'Speak calmly.'
      });

      await instructable.speak('Test', { instructions: 'Sound excited!' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ instructions: 'Sound excited!' })
      );
    });

    it('sends instructions on the streaming path', async () => {
      const instructable = new OpenAITTSProvider({
        apiKey: 'k',
        model: 'gpt-4o-mini-tts',
        instructions: 'Whisper.'
      });

      for await (const _ of instructable.speakStream('Test')) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ instructions: 'Whisper.' })
      );
    });

    it('omits instructions when none are configured', async () => {
      const instructable = new OpenAITTSProvider({
        apiKey: 'k',
        model: 'gpt-4o-mini-tts'
      });

      await instructable.speak('Test');

      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('instructions');
    });

    it('drops instructions on tts-1 with a single warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const legacy = new OpenAITTSProvider({
          apiKey: 'k',
          model: 'tts-1',
          instructions: 'Speak calmly.'
        });

        await legacy.speak('One');
        await legacy.speak('Two');

        expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('instructions');
        expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('instructions');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('tts-1');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not warn when instructions are sent to an instructable model', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const instructable = new OpenAITTSProvider({
          apiKey: 'k',
          model: 'gpt-4o-mini-tts',
          instructions: 'Speak calmly.'
        });

        await instructable.speak('One');
        await instructable.speak('Two');

        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('sends instructions to any future gpt-* TTS model', async () => {
      const future = new OpenAITTSProvider({
        apiKey: 'k',
        model: 'gpt-5-tts',
        instructions: 'Narrate briskly.'
      });

      await future.speak('Test');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5-tts',
          instructions: 'Narrate briskly.'
        })
      );
    });

    it('honors an instructions override when the base model is legacy', async () => {
      const legacy = new OpenAITTSProvider({ apiKey: 'k', model: 'tts-1' });

      await legacy.speak('Test', {
        model: 'gpt-4o-mini-tts',
        instructions: 'Narrate like a documentary.'
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini-tts',
          instructions: 'Narrate like a documentary.'
        })
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

      for await (const _ of provider.speakStream('Test', { format: 'pcm' })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ response_format: 'pcm' })
      );
    });

    it('streams from a Node Readable-style async-iterable body (no getReader)', async () => {
      // The OpenAI SDK returns a Node Readable body when running with its
      // Node shims (e.g. Node < 18). Regression test for
      // "TypeError: response.body?.getReader is not a function".
      const chunk1 = Buffer.from('node-chunk-1');
      const chunk2 = Buffer.from('node-chunk-2');
      const nodeStyleBody = {
        async *[Symbol.asyncIterator]() {
          yield chunk1;
          yield chunk2;
        }
      };
      mockCreate.mockResolvedValue({ body: nodeStyleBody });

      const chunks: Buffer[] = [];
      for await (const chunk of provider.speakStream('Test')) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(Buffer.concat(chunks).toString()).toBe('node-chunk-1node-chunk-2');
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
