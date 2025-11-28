import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { GeminiLLMProvider } from '../src/index.js';
import { createMockStream } from '../../test-utils.js';

// Mock the Google GenAI SDK
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn()
}));

import { GoogleGenAI } from '@google/genai';

describe('GeminiLLMProvider', () => {
  let provider: GeminiLLMProvider;
  let mockGenerateContent: Mock;
  let mockGenerateContentStream: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateContent = vi.fn();
    mockGenerateContentStream = vi.fn();

    (GoogleGenAI as unknown as Mock).mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream
      }
    }));

    provider = new GeminiLLMProvider({
      apiKey: 'test-api-key',
      model: 'gemini-2.5-flash'
    });
  });

  describe('constructor', () => {
    it('should use default model when not specified', () => {
      const defaultProvider = new GeminiLLMProvider({
        apiKey: 'test-key'
      });
      expect(defaultProvider.name).toBe('gemini-llm');
    });

    it('should pass apiKey to GoogleGenAI client', () => {
      new GeminiLLMProvider({
        apiKey: 'test-key'
      });

      expect(GoogleGenAI).toHaveBeenCalledWith({
        apiKey: 'test-key'
      });
    });
  });

  describe('complete()', () => {
    it('should return fullText from response', async () => {
      mockGenerateContent.mockResolvedValue({
        text: 'Hello, world!'
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello, world!');
    });

    it('should include raw response', async () => {
      const mockResponse = { text: 'Test', candidates: [] };
      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.raw).toEqual(mockResponse);
    });

    it('should extract system instruction from messages', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'You are helpful'
          })
        })
      );
    });

    it('should not include system in contents', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' }
        ]
      });

      const call = mockGenerateContent.mock.calls[0][0];
      const hasSystemInContents = call.contents.some(
        (c: { role: string }) => c.role === 'system'
      );
      expect(hasSystemInContents).toBe(false);
    });

    it('should pass temperature config', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.5 }
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ temperature: 0.5 })
        })
      );
    });

    it('should pass topP config', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { topP: 0.9 }
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ topP: 0.9 })
        })
      );
    });

    it('should pass maxTokens as maxOutputTokens', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { maxTokens: 100 }
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ maxOutputTokens: 100 })
        })
      );
    });

    it('should pass model to API', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.5-flash' })
      );
    });

    it('should handle empty/null text', async () => {
      mockGenerateContent.mockResolvedValue({ text: null });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should map user messages correctly', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Hello' }]
            }
          ]
        })
      );
    });

    it('should map assistant messages to model role', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Response' });

      await provider.complete({
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' }
        ]
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[1].role).toBe('model');
    });

    it('should map vision attachments', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'I see an image' });

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/png;base64,abc123' }]
          }
        ]
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[0].parts).toHaveLength(2);
      expect(call.contents[0].parts[1]).toEqual({
        inlineData: {
          mimeType: 'image/png',
          data: 'abc123'
        }
      });
    });

    it('should handle non-data-URI attachments', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'I see an image' });

      await provider.complete({
        messages: [
          {
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'rawbase64data' }]
          }
        ]
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
      expect(call.contents[0].parts[1].inlineData.data).toBe('rawbase64data');
    });

    it('should propagate API errors', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('API Error');
    });
  });

  describe('stream()', () => {
    it('should yield chunks from stream', async () => {
      const mockChunks = [{ text: 'Hello' }, { text: ' World' }, { text: '!' }];
      mockGenerateContentStream.mockResolvedValue(createMockStream(mockChunks));

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
      const mockChunks = [{ text: 'Hi' }];
      mockGenerateContentStream.mockResolvedValue(createMockStream(mockChunks));

      const results: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        results.push({ content: chunk.content, done: chunk.done });
      }

      // Last chunk should have done: true
      expect(results[results.length - 1].done).toBe(true);
    });

    it('should include raw chunk in response', async () => {
      const mockChunks = [{ text: 'Hi' }];
      mockGenerateContentStream.mockResolvedValue(createMockStream(mockChunks));

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          expect(chunk.raw).toBeDefined();
        }
      }
    });

    it('should pass config to streaming request', async () => {
      mockGenerateContentStream.mockResolvedValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }],
        config: { temperature: 0.7, topP: 0.95, maxTokens: 500 }
      })) {
        // consume stream
      }

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            temperature: 0.7,
            topP: 0.95,
            maxOutputTokens: 500
          })
        })
      );
    });

    it('should extract system instruction in streaming', async () => {
      mockGenerateContentStream.mockResolvedValue(createMockStream([]));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [
          { role: 'system', content: 'Be concise' },
          { role: 'user', content: 'Hi' }
        ]
      })) {
        // consume stream
      }

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction: 'Be concise'
          })
        })
      );
    });

    it('should handle null text in chunks', async () => {
      const mockChunks = [{ text: 'Hello' }, { text: null }, { text: ' World' }];
      mockGenerateContentStream.mockResolvedValue(createMockStream(mockChunks));

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
