import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { BedrockLLMProvider } from '../src/index.js';
import { createMockStream } from '../../test-utils.js';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn()
}));

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand
} from '@aws-sdk/client-bedrock-runtime';

describe('BedrockLLMProvider', () => {
  let provider: BedrockLLMProvider;
  let mockSend: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSend = vi.fn();
    (BedrockRuntimeClient as unknown as Mock).mockImplementation(() => ({
      send: mockSend
    }));

    provider = new BedrockLLMProvider({
      region: 'us-east-1',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    });
  });

  describe('constructor', () => {
    it('should use default region when not specified', () => {
      new BedrockLLMProvider();

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' })
      );
    });

    it('should use default model when not specified', () => {
      const defaultProvider = new BedrockLLMProvider();
      expect(defaultProvider.name).toBe('bedrock-llm');
    });

    it('should accept custom region', () => {
      new BedrockLLMProvider({ region: 'eu-west-1' });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-1' })
      );
    });

    it('should pass credentials when provided', () => {
      new BedrockLLMProvider({
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret'
        }
      });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            accessKeyId: 'test-key',
            secretAccessKey: 'test-secret'
          }
        })
      );
    });

    it('should accept session token in credentials', () => {
      new BedrockLLMProvider({
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          sessionToken: 'test-token'
        }
      });

      expect(BedrockRuntimeClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({
            sessionToken: 'test-token'
          })
        })
      );
    });
  });

  describe('complete()', () => {
    it('should return fullText from response', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'Hello, world!' }]
          }
        }
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello, world!');
    });

    it('should include raw response', async () => {
      const mockResponse = {
        output: {
          message: {
            content: [{ text: 'Test' }]
          }
        }
      };
      mockSend.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.raw).toEqual(mockResponse);
    });

    it('should use ConverseCommand', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: '' }] } }
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(ConverseCommand).toHaveBeenCalled();
    });

    it('should pass modelId to command', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: '' }] } }
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(ConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
        })
      );
    });

    it('should extract system content from messages', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'Response' }] } }
      });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      expect(ConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [{ text: 'You are helpful' }]
        })
      );
    });

    it('should not include system in messages array', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'Response' }] } }
      });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      const call = (ConverseCommand as unknown as Mock).mock.calls[0][0];
      const hasSystemInMessages = call.messages.some(
        (m: { role: string }) => m.role === 'system'
      );
      expect(hasSystemInMessages).toBe(false);
    });

    it('should pass inference config', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'Response' }] } }
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.5, topP: 0.9, maxTokens: 100 }
      });

      expect(ConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          inferenceConfig: expect.objectContaining({
            temperature: 0.5,
            topP: 0.9,
            maxTokens: 100
          })
        })
      );
    });

    it('should use default maxTokens of 4096', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'Response' }] } }
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(ConverseCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          inferenceConfig: expect.objectContaining({
            maxTokens: 4096
          })
        })
      );
    });

    it('should handle empty content', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [] } }
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should handle missing output', async () => {
      mockSend.mockResolvedValue({});

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should join multiple text blocks', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'Hello' }, { text: ' World' }]
          }
        }
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello World');
    });

    it('should filter non-text blocks', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [
              { text: 'Hello' },
              { toolUse: { name: 'search' } },
              { text: ' World' }
            ]
          }
        }
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello World');
    });

    it('should map vision attachments', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'I see an image' }] } }
      });

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/png;base64,abc123' }]
          }
        ]
      });

      const call = (ConverseCommand as unknown as Mock).mock.calls[0][0];
      expect(call.messages[0].content).toHaveLength(2);
      expect(call.messages[0].content[1]).toEqual({
        image: {
          format: 'png',
          source: {
            bytes: Buffer.from('abc123', 'base64')
          }
        }
      });
    });

    it('should normalize jpg to jpeg format', async () => {
      mockSend.mockResolvedValue({
        output: { message: { content: [{ text: 'I see an image' }] } }
      });

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/jpg;base64,abc123' }]
          }
        ]
      });

      const call = (ConverseCommand as unknown as Mock).mock.calls[0][0];
      expect(call.messages[0].content[1].image.format).toBe('jpeg');
    });

    it('should propagate API errors', async () => {
      mockSend.mockRejectedValue(new Error('AccessDeniedException'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('AccessDeniedException');
    });
  });

  describe('stream()', () => {
    it('should yield chunks from stream', async () => {
      const mockEvents = [
        { contentBlockDelta: { delta: { text: 'Hello' } } },
        { contentBlockDelta: { delta: { text: ' World' } } },
        { contentBlockDelta: { delta: { text: '!' } } }
      ];
      mockSend.mockResolvedValue({
        stream: createMockStream(mockEvents)
      });

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
      const mockEvents = [{ contentBlockDelta: { delta: { text: 'Hi' } } }];
      mockSend.mockResolvedValue({
        stream: createMockStream(mockEvents)
      });

      const results: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        results.push({ content: chunk.content, done: chunk.done });
      }

      // Last chunk should have done: true
      expect(results[results.length - 1].done).toBe(true);
    });

    it('should use ConverseStreamCommand', async () => {
      mockSend.mockResolvedValue({ stream: createMockStream([]) });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        // consume stream
      }

      expect(ConverseStreamCommand).toHaveBeenCalled();
    });

    it('should pass inference config to stream', async () => {
      mockSend.mockResolvedValue({ stream: createMockStream([]) });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.7, topP: 0.95, maxTokens: 500 }
      })) {
        // consume stream
      }

      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          inferenceConfig: expect.objectContaining({
            temperature: 0.7,
            topP: 0.95,
            maxTokens: 500
          })
        })
      );
    });

    it('should handle missing stream', async () => {
      mockSend.mockResolvedValue({});

      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(chunk.content);
      }

      // Should still yield final done chunk
      expect(chunks).toContain('');
    });

    it('should include raw event in chunks', async () => {
      const mockEvents = [{ contentBlockDelta: { delta: { text: 'Hi' } } }];
      mockSend.mockResolvedValue({
        stream: createMockStream(mockEvents)
      });

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          expect(chunk.raw).toBeDefined();
        }
      }
    });

    it('should ignore non-content events', async () => {
      const mockEvents = [
        { messageStart: {} },
        { contentBlockDelta: { delta: { text: 'Hello' } } },
        { contentBlockStop: {} },
        { messageStop: {} }
      ];
      mockSend.mockResolvedValue({
        stream: createMockStream(mockEvents)
      });

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
