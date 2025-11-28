import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { AnthropicLLMProvider } from '../src/index.js';
import {
  createMockAnthropicResponse,
  createMockAnthropicStreamEvents,
  createMockStream
} from '../../test-utils.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn()
}));

import Anthropic from '@anthropic-ai/sdk';

describe('AnthropicLLMProvider', () => {
  let provider: AnthropicLLMProvider;
  let mockCreate: Mock;
  let mockStream: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreate = vi.fn();
    mockStream = vi.fn();
    (Anthropic as unknown as Mock).mockImplementation(() => ({
      messages: {
        create: mockCreate,
        stream: mockStream
      }
    }));

    provider = new AnthropicLLMProvider({
      apiKey: 'test-api-key',
      model: 'claude-sonnet-4-5-20250929'
    });
  });

  describe('constructor', () => {
    it('should use default model (claude-sonnet-4-5-20250929) when not specified', async () => {
      const defaultProvider = new AnthropicLLMProvider({
        apiKey: 'test-key'
      });
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await defaultProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-5-20250929' })
      );
    });

    it('should use custom model when specified', async () => {
      const customProvider = new AnthropicLLMProvider({
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229'
      });
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await customProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-3-opus-20240229' })
      );
    });

    it('should use default maxTokens (4096) when not specified', async () => {
      const defaultProvider = new AnthropicLLMProvider({
        apiKey: 'test-key'
      });
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await defaultProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 4096 })
      );
    });

    it('should use custom maxTokens when specified', async () => {
      const customProvider = new AnthropicLLMProvider({
        apiKey: 'test-key',
        maxTokens: 8192
      });
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await customProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 8192 })
      );
    });

    it('should pass apiKey to Anthropic client', () => {
      new AnthropicLLMProvider({
        apiKey: 'sk-ant-test-key'
      });

      expect(Anthropic).toHaveBeenCalledWith({
        apiKey: 'sk-ant-test-key'
      });
    });
  });

  describe('malformed responses', () => {
    it('should handle response with empty content array', async () => {
      mockCreate.mockResolvedValue({
        content: []
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle response with null content', async () => {
      mockCreate.mockResolvedValue({
        content: null
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle response with non-text content blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', id: 'tool1', name: 'search' },
          { type: 'text', text: 'Hello' }
        ]
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello');
    });

    it('should handle response with missing text in text block', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text' } // Missing text property
        ]
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });
  });

  describe('complete()', () => {
    it('should return fullText from response', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Hello!'));

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello!');
    });

    it('should include raw response', async () => {
      const mockResponse = createMockAnthropicResponse('Response');
      mockCreate.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.raw).toBeDefined();
      expect(result.raw).toEqual(mockResponse);
    });

    it('should extract system prompt from messages', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are helpful'
        })
      );
    });

    it('should not include system message in messages array', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      const call = mockCreate.mock.calls[0][0];
      const hasSystemInMessages = call.messages.some(
        (m: { role: string }) => m.role === 'system'
      );
      expect(hasSystemInMessages).toBe(false);
    });

    it('should pass temperature config', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.5 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 })
      );
    });

    it('should pass topP config', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { topP: 0.9 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ top_p: 0.9 })
      );
    });

    it('should pass maxTokens config', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { maxTokens: 100 }
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 100 })
      );
    });

    it('should use default maxTokens from constructor', async () => {
      const customProvider = new AnthropicLLMProvider({
        apiKey: 'test-key',
        maxTokens: 8192
      });

      mockCreate.mockResolvedValue(createMockAnthropicResponse('Response'));

      await customProvider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 8192 })
      );
    });

    it('should handle empty text blocks', async () => {
      mockCreate.mockResolvedValue({
        content: []
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should join multiple text blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' World' }
        ]
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello World');
    });

    it('should filter non-text blocks', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'tool1', name: 'search' },
          { type: 'text', text: ' World' }
        ]
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello World');
    });

    it('should map vision attachments to Anthropic format', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('I see an image'));

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/png;base64,abc123' }]
          }
        ]
      });

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages[0].content).toEqual([
        { type: 'text', text: 'What is this?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'abc123'
          }
        }
      ]);
    });

    it('should handle multiple attachments', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('I see images'));

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

    it('should handle non-data-URI attachments', async () => {
      mockCreate.mockResolvedValue(createMockAnthropicResponse('I see an image'));

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'rawbase64data' }]
          }
        ]
      });

      const call = mockCreate.mock.calls[0][0];
      expect(call.messages[0].content[1].source.media_type).toBe('image/jpeg');
      expect(call.messages[0].content[1].source.data).toBe('rawbase64data');
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
      const mockEvents = createMockAnthropicStreamEvents(['Hello', ' World', '!']);
      mockStream.mockReturnValue(createMockStream(mockEvents));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['Hello', ' World', '!']);
    });

    it('should set done flag correctly', async () => {
      const mockEvents = createMockAnthropicStreamEvents(['Hi']);
      mockStream.mockReturnValue(createMockStream(mockEvents));

      const chunks: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push({ content: chunk.content, done: chunk.done });
      }

      // Last chunk should have done: true
      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it('should include raw event in chunks', async () => {
      const mockEvents = createMockAnthropicStreamEvents(['Hi']);
      mockStream.mockReturnValue(createMockStream(mockEvents));

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          expect(chunk.raw).toBeDefined();
        }
      }
    });

    it('should extract system prompt in streaming', async () => {
      mockStream.mockReturnValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [
          { role: 'system', content: 'Be concise' },
          { role: 'user', content: 'Hi' }
        ]
      })) {
        // consume stream
      }

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'Be concise'
        })
      );
    });

    it('should pass config to streaming request', async () => {
      mockStream.mockReturnValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.7, topP: 0.95, maxTokens: 500 }
      })) {
        // consume stream
      }

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 500
        })
      );
    });

    it('should ignore non-text-delta events', async () => {
      const mockEvents = [
        { type: 'message_start' },
        { type: 'content_block_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'ping' }, // Should be ignored
        { type: 'content_block_stop' }
      ];
      mockStream.mockReturnValue(createMockStream(mockEvents));

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(chunks).toEqual(['Hello']);
    });
  });
});
