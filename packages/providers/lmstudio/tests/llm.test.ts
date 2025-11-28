import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { LMStudioLLMProvider } from '../src/index.js';
import {
  createMockOpenAIChatCompletion,
  createMockOpenAIStreamChunks,
  createMockStream
} from '../../test-utils.js';

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn()
}));

import OpenAI from 'openai';

describe('LMStudioLLMProvider', () => {
  let provider: LMStudioLLMProvider;
  let mockCreate: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreate = vi.fn();
    (OpenAI as unknown as Mock).mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    }));

    provider = new LMStudioLLMProvider({
      baseUrl: 'http://localhost:1234/v1',
      model: 'llama-3.2-3b'
    });
  });

  describe('constructor', () => {
    it('should use default baseUrl when not specified', () => {
      new LMStudioLLMProvider();

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://localhost:1234/v1'
        })
      );
    });

    it('should use default model when not specified', () => {
      const defaultProvider = new LMStudioLLMProvider();
      expect(defaultProvider.name).toBe('lmstudio-llm');
    });

    it('should accept custom baseUrl', () => {
      new LMStudioLLMProvider({
        baseUrl: 'http://192.168.1.100:1234/v1'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://192.168.1.100:1234/v1'
        })
      );
    });

    it('should use placeholder API key', () => {
      new LMStudioLLMProvider();

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'lm-studio'
        })
      );
    });
  });

  describe('complete()', () => {
    it('should return fullText from completion', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Hello!'));

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello!');
    });

    it('should include raw response', async () => {
      const mockResponse = createMockOpenAIChatCompletion('Response');
      mockCreate.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.raw).toEqual(mockResponse);
    });

    it('should pass model to API', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.2-3b' })
      );
    });

    it('should pass temperature config', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.5 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 })
      );
    });

    it('should pass topP config', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { topP: 0.9 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 0.9 })
      );
    });

    it('should pass maxTokens config', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { maxTokens: 100 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 100 })
      );
    });

    it('should handle empty response content', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion(null));

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle empty choices array', async () => {
      mockCreate.mockResolvedValue({
        choices: []
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should set stream to false', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false })
      );
    });

    it('should map messages correctly', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' }
        ]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' }
          ]
        })
      );
    });

    it('should map vision attachments (for supported models)', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('I see an image'));

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/png;base64,abc123' }]
          }
        ]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is this?' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } }
              ]
            }
          ]
        })
      );
    });

    it('should propagate connection errors', async () => {
      mockCreate.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('stream()', () => {
    it('should yield chunks from stream', async () => {
      const mockChunks = createMockOpenAIStreamChunks(['Hello', ' World', '!']);
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      expect(chunks).toContain('Hello');
      expect(chunks).toContain(' World');
      expect(chunks).toContain('!');
    });

    it('should set done flag correctly', async () => {
      const mockChunks = createMockOpenAIStreamChunks(['Hi']);
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const results: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        results.push({ content: chunk.content, done: chunk.done });
      }

      // Last chunk should have done: true
      expect(results[results.length - 1].done).toBe(true);
    });

    it('should include raw in chunks', async () => {
      const mockChunks = createMockOpenAIStreamChunks(['Hi']);
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          expect(chunk.raw).toBeDefined();
        }
      }
    });

    it('should set stream to true', async () => {
      mockCreate.mockResolvedValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true })
      );
    });

    it('should pass model to streaming request', async () => {
      mockCreate.mockResolvedValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.2-3b' })
      );
    });

    it('should pass config to streaming request', async () => {
      mockCreate.mockResolvedValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.7, topP: 0.95, maxTokens: 500 }
      })) {
        // consume stream
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 500
        })
      );
    });

    it('should handle empty delta content', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: ' World' } }] }
      ];
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      expect(chunks).toContain('Hello');
      expect(chunks).toContain(' World');
    });
  });
});
