import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';

vi.mock('node-fetch', () => {
  const fn = vi.fn();
  return { default: fn };
});

import fetch from 'node-fetch';
import { OllamaLLMProvider } from '../src/index.js';

const sampleLines = [
  JSON.stringify({ message: { content: 'Hello ' } }),
  JSON.stringify({ message: { content: 'World' } })
];

describe('OllamaLLMProvider stream parsing', () => {
  const provider = new OllamaLLMProvider({ baseUrl: 'http://localhost:11434', model: 'test' });

  it('yields content chunks from ndjson stream', async () => {
    const body = Readable.from(sampleLines.map((l) => l + '\n')) as any;

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, body } as any);

    const chunks: string[] = [];
    for await (const chunk of provider.stream!({ messages: [{ role: 'user', content: 'hi' }] })) {
      if (!chunk.done) chunks.push(chunk.content);
    }

    expect(chunks.join('')).toBe('Hello World');
    expect(fetch).toHaveBeenCalled();
  });
});
