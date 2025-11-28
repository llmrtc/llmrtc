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
      (fetch as unknown as Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message: { content: '' } })
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hi' }]
      });

      const call = (fetch as unknown as Mock).mock.calls[0];
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
      (fetch as unknown as Mock).mockResolvedValue({
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

      const call = (fetch as unknown as Mock).mock.calls[0];
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

      const call = (fetch as unknown as Mock).mock.calls[0];
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
});
