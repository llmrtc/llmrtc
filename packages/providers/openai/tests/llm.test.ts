import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { OpenAILLMProvider } from '../src/index.js';
import {
  createMockOpenAIChatCompletion,
  createMockOpenAIStreamChunks,
  createMockStream
} from '../../test-utils.js';

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn(),
  toFile: vi.fn().mockResolvedValue({ name: 'audio.webm' })
}));

import OpenAI from 'openai';

describe('OpenAILLMProvider', () => {
  let provider: OpenAILLMProvider;
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

    provider = new OpenAILLMProvider({
      apiKey: 'test-api-key',
      model: 'gpt-4o-mini'
    });
  });

  describe('constructor', () => {
    it('should use default model (gpt-4o-mini) when not specified', async () => {
      const defaultProvider = new OpenAILLMProvider({
        apiKey: 'test-key'
      });
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await defaultProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o-mini' })
      );
    });

    it('should use custom model when specified', async () => {
      const customProvider = new OpenAILLMProvider({
        apiKey: 'test-key',
        model: 'gpt-4-turbo'
      });
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await customProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4-turbo' })
      );
    });

    it('should pass baseURL to OpenAI client', () => {
      new OpenAILLMProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });

      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com'
      });
    });

    it('should pass apiKey to OpenAI client', () => {
      new OpenAILLMProvider({
        apiKey: 'sk-test-key-123'
      });

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-test-key-123' })
      );
    });
  });

  describe('malformed responses', () => {
    it('should handle response with undefined message', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: undefined }]
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle response with null choices', async () => {
      mockCreate.mockResolvedValue({
        choices: null
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle response with missing choices property', async () => {
      mockCreate.mockResolvedValue({});

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle streaming chunk with undefined delta', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: undefined }] },
        { choices: [{ delta: { content: ' World' } }] }
      ];
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      expect(chunks.join('')).toContain('Hello');
      expect(chunks.join('')).toContain('World');
    });

    it('should handle streaming chunk with null choices', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: null },
        { choices: [{ delta: { content: ' World' } }] }
      ];
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      // Should handle gracefully without crashing
      expect(chunks.length).toBeGreaterThan(0);
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

      expect(result.raw).toBeDefined();
      expect(result.raw).toEqual(mockResponse);
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

    it('should handle empty/null response content', async () => {
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

    it('should set stream to false for complete()', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false })
      );
    });

    it('should map messages to OpenAI format', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('Response'));

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' }
        ]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' }
          ]
        })
      );
    });

    it('should map vision attachments to image_url format', async () => {
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

    it('should handle multiple attachments', async () => {
      mockCreate.mockResolvedValue(createMockOpenAIChatCompletion('I see images'));

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'Compare these',
            attachments: [
              { data: 'data:image/png;base64,img1' },
              { data: 'data:image/jpeg;base64,img2' }
            ]
          }
        ]
      });

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages[0].content).toHaveLength(3); // text + 2 images
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API Error: 401 Unauthorized'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('API Error: 401 Unauthorized');
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

      // Includes final empty chunk with done: true
      expect(chunks).toEqual(['Hello', ' World', '!', '']);
    });

    it('should set done flag correctly', async () => {
      const mockChunks = createMockOpenAIStreamChunks(['Hello']);
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push({ content: chunk.content, done: chunk.done });
      }

      // All but last should be done: false, last should be done: true
      expect(chunks[chunks.length - 1].done).toBe(true);
      expect(chunks.slice(0, -1).every((c) => !c.done)).toBe(true);
    });

    it('should include raw response in chunks', async () => {
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

    it('should set stream to true for stream()', async () => {
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

    it('should handle empty delta content', async () => {
      const mockChunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: {} }] }, // No content
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

    it('should handle empty choices', async () => {
      const mockChunks = [{ choices: [] }];
      mockCreate.mockResolvedValue(createMockStream(mockChunks));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      // Should still complete with empty content
      expect(chunks).toContain('');
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
