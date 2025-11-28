import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenRouterLLMProvider } from '../src/index.js';
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

describe('OpenRouterLLMProvider', () => {
  let provider: OpenRouterLLMProvider;
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

    provider = new OpenRouterLLMProvider({
      apiKey: 'test-api-key',
      model: 'anthropic/claude-3.5-sonnet'
    });
  });

  describe('constructor', () => {
    it('should use default baseURL', () => {
      new OpenRouterLLMProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://openrouter.ai/api/v1'
        })
      );
    });

    it('should accept custom baseURL', () => {
      new OpenRouterLLMProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4',
        baseURL: 'https://custom.openrouter.ai/api/v1'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://custom.openrouter.ai/api/v1'
        })
      );
    });

    it('should pass apiKey to OpenAI client', () => {
      new OpenRouterLLMProvider({
        apiKey: 'sk-or-test',
        model: 'openai/gpt-4'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-or-test'
        })
      );
    });

    it('should set HTTP-Referer header when siteUrl provided', () => {
      new OpenRouterLLMProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4',
        siteUrl: 'https://mysite.com'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultHeaders: expect.objectContaining({
            'HTTP-Referer': 'https://mysite.com'
          })
        })
      );
    });

    it('should set X-Title header when siteName provided', () => {
      new OpenRouterLLMProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4',
        siteName: 'My App'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultHeaders: expect.objectContaining({
            'X-Title': 'My App'
          })
        })
      );
    });

    it('should set both headers when both provided', () => {
      new OpenRouterLLMProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4',
        siteUrl: 'https://mysite.com',
        siteName: 'My App'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultHeaders: {
            'HTTP-Referer': 'https://mysite.com',
            'X-Title': 'My App'
          }
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

    it('should pass model in provider/model format', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'anthropic/claude-3.5-sonnet' })
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

    it('should set stream to false', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false })
      );
    });

    it('should map vision attachments', async () => {
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

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error: Model not found'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('API Error: Model not found');
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
        expect.objectContaining({ model: 'anthropic/claude-3.5-sonnet' })
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
  });
});
