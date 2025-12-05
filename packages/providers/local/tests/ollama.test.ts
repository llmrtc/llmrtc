import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { Readable } from 'node:stream';
import { OllamaLLMProvider } from '../src/index.js';
import { createMockFetchResponse, createMockStream } from '../../test-utils.js';

vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

import fetch from 'node-fetch';

describe('OllamaLLMProvider', () => {
  let provider: OllamaLLMProvider;

  beforeEach(() => {
    vi.clearAllMocks();

    provider = new OllamaLLMProvider({
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434'
    });
  });

  describe('constructor', () => {
    it('should use default model when not specified', () => {
      const defaultProvider = new OllamaLLMProvider();
      expect(defaultProvider.name).toBe('ollama-llm');
    });

    it('should use default baseUrl when not specified', () => {
      const defaultProvider = new OllamaLLMProvider();
      expect(defaultProvider.name).toBe('ollama-llm');
    });

    it('should accept custom model', () => {
      const customProvider = new OllamaLLMProvider({ model: 'mistral' });
      expect(customProvider.name).toBe('ollama-llm');
    });

    it('should accept custom baseUrl', () => {
      const customProvider = new OllamaLLMProvider({ baseUrl: 'http://192.168.1.100:11434' });
      expect(customProvider.name).toBe('ollama-llm');
    });
  });

  describe('complete()', () => {
    it('should return fullText from response', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message: { content: 'Hello, world!' }
        })
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('Hello, world!');
    });

    it('should include raw response', async () => {
      const mockResponse = { message: { content: 'Test' } };
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.raw).toEqual(mockResponse);
    });

    it('should call correct endpoint', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: { content: '' } })
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.any(Object)
      );
    });

    it('should set stream to false', async () => {
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: '' } })
        });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      // Second call is /api/chat (first is /api/show)
      const call = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(call[1].body);
      expect(body.stream).toBe(false);
    });

    it('should pass model in request', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: { content: '' } })
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      const call = (fetch as unknown as Mock).mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.model).toBe('llama3.1');
    });

    it('should map messages to Ollama format', async () => {
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: '' } })
        });

      await provider.complete({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' }
        ]
      });

      // Second call is /api/chat (first is /api/show)
      const call = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(call[1].body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' }
      ]);
    });

    it('should handle empty response content', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: {} })
      });

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      expect(result.fullText).toBe('');
    });

    it('should throw on API error', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: false,
        status: 500
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('ollama failed: 500');
    });

    it('should throw on connection error', async () => {
      (fetch as unknown as Mock).mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      ).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('stream()', () => {
    it('should yield content chunks from ndjson stream', async () => {
      const chunks = [
        JSON.stringify({ message: { content: 'Hello' } }) + '\n',
        JSON.stringify({ message: { content: ' World' } }) + '\n'
      ];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      const received: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          received.push(chunk.content);
        }
      }

      expect(received.join('')).toBe('Hello World');
    });

    it('should set done flag correctly', async () => {
      const chunks = [JSON.stringify({ message: { content: 'Hi' } }) + '\n'];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      const results: Array<{ content: string; done: boolean }> = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        results.push({ content: chunk.content, done: chunk.done });
      }

      // Last chunk should be done: true with empty content
      expect(results[results.length - 1].done).toBe(true);
      expect(results[results.length - 1].content).toBe('');
    });

    it('should include raw in chunks', async () => {
      const chunks = [JSON.stringify({ message: { content: 'Hi' } }) + '\n'];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          expect(chunk.raw).toBeDefined();
        }
      }
    });

    it('should call stream endpoint', async () => {
      const body = Readable.from([]);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        // consume stream
      }

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.any(Object)
      );
    });

    it('should set stream to true in request', async () => {
      const streamBody = Readable.from([]);

      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          body: streamBody
        });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        // consume stream
      }

      // Second call is /api/chat (first is /api/show)
      const call = (fetch as unknown as Mock).mock.calls[1];
      const requestBody = JSON.parse(call[1].body);
      expect(requestBody.stream).toBe(true);
    });

    it('should throw when body is missing', async () => {
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body: null
      });

      await expect(async () => {
        for await (const _ of provider.stream({
          messages: [{ role: 'user', content: 'Hi' }]
        })) {
          // consume stream
        }
      }).rejects.toThrow('ollama stream missing body');
    });

    it('should handle multiple JSON objects in single chunk', async () => {
      const multiLine =
        JSON.stringify({ message: { content: 'A' } }) +
        '\n' +
        JSON.stringify({ message: { content: 'B' } }) +
        '\n';
      const body = Readable.from([multiLine]);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      const received: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          received.push(chunk.content);
        }
      }

      expect(received).toEqual(['A', 'B']);
    });

    it('should skip invalid JSON lines', async () => {
      const chunks = [
        JSON.stringify({ message: { content: 'Valid' } }) + '\n',
        'invalid json\n',
        JSON.stringify({ message: { content: 'Also Valid' } }) + '\n'
      ];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      const received: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          received.push(chunk.content);
        }
      }

      expect(received).toEqual(['Valid', 'Also Valid']);
    });

    it('should handle empty content in chunk', async () => {
      const chunks = [
        JSON.stringify({ message: { content: 'Hi' } }) + '\n',
        JSON.stringify({ message: {} }) + '\n',
        JSON.stringify({ message: { content: 'Bye' } }) + '\n'
      ];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        body
      });

      const received: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        if (chunk.content) {
          received.push(chunk.content);
        }
      }

      expect(received).toEqual(['Hi', 'Bye']);
    });
  });

  describe('vision attachments', () => {
    it('should map single vision attachment to Ollama format', async () => {
      // Mock /api/show to return vision capability, then /api/chat for the request
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['completion', 'vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'I see an image' } })
        });

      const result = await provider.complete({
        messages: [{
          role: 'user',
          content: 'What is this?',
          attachments: [{ data: 'data:image/png;base64,abc123' }]
        }]
      });

      expect(result.fullText).toBe('I see an image');

      // Check that the chat call included images (second call)
      const chatCall = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(body.messages[0].images).toEqual(['abc123']);
    });

    it('should strip data URI prefix and send raw base64', async () => {
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'OK' } })
        });

      await provider.complete({
        messages: [{
          role: 'user',
          content: 'Describe',
          attachments: [{ data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }]
        }]
      });

      const chatCall = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      // Should be raw base64 without the data: prefix
      expect(body.messages[0].images[0]).toBe('/9j/4AAQSkZJRg==');
    });

    it('should handle raw base64 without data URI prefix', async () => {
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'OK' } })
        });

      await provider.complete({
        messages: [{
          role: 'user',
          content: 'Describe',
          attachments: [{ data: 'rawbase64data' }]
        }]
      });

      const chatCall = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      // Should pass through unchanged
      expect(body.messages[0].images[0]).toBe('rawbase64data');
    });

    it('should map multiple vision attachments', async () => {
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'Two images' } })
        });

      await provider.complete({
        messages: [{
          role: 'user',
          content: 'Compare these',
          attachments: [
            { data: 'data:image/png;base64,img1' },
            { data: 'data:image/png;base64,img2' }
          ]
        }]
      });

      const chatCall = (fetch as unknown as Mock).mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(body.messages[0].images).toEqual(['img1', 'img2']);
    });

    it('should throw error when sending images to non-vision model', async () => {
      // Mock /api/show to return NO vision capability
      (fetch as unknown as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ capabilities: ['completion'] })
      });

      await expect(
        provider.complete({
          messages: [{
            role: 'user',
            content: 'What is this?',
            attachments: [{ data: 'data:image/png;base64,abc123' }]
          }]
        })
      ).rejects.toThrow('does not support vision');
    });

    it('should cache vision capability check', async () => {
      // First call: /api/show returns vision capability
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'First' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'Second' } })
        });

      // First request
      await provider.complete({
        messages: [{ role: 'user', content: 'First request' }]
      });

      // Second request - should NOT call /api/show again
      await provider.complete({
        messages: [{ role: 'user', content: 'Second request' }]
      });

      // Should have 3 calls total: 1 for /api/show, 2 for /api/chat
      expect(fetch).toHaveBeenCalledTimes(3);

      // First call should be to /api/show
      expect((fetch as unknown as Mock).mock.calls[0][0]).toBe('http://localhost:11434/api/show');
      // Second and third calls should be to /api/chat
      expect((fetch as unknown as Mock).mock.calls[1][0]).toBe('http://localhost:11434/api/chat');
      expect((fetch as unknown as Mock).mock.calls[2][0]).toBe('http://localhost:11434/api/chat');
    });

    it('should handle /api/show failure gracefully', async () => {
      // Mock /api/show to fail, then /api/chat to succeed
      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: { content: 'OK' } })
        });

      // Should still work for non-vision requests
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(result.fullText).toBe('OK');
    });

    it('should work with streaming and vision attachments', async () => {
      const chunks = [
        JSON.stringify({ message: { content: 'I see ' } }) + '\n',
        JSON.stringify({ message: { content: 'an image' } }) + '\n'
      ];
      const body = Readable.from(chunks);

      (fetch as unknown as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ capabilities: ['vision'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          body
        });

      const received: string[] = [];
      for await (const chunk of provider.stream({
        messages: [{
          role: 'user',
          content: 'What is this?',
          attachments: [{ data: 'data:image/png;base64,abc123' }]
        }]
      })) {
        if (chunk.content) {
          received.push(chunk.content);
        }
      }

      expect(received.join('')).toBe('I see an image');

      // Verify images were included in the stream request
      const streamCall = (fetch as unknown as Mock).mock.calls[1];
      const streamBody = JSON.parse(streamCall[1].body);
      expect(streamBody.messages[0].images).toEqual(['abc123']);
    });
  });
});
