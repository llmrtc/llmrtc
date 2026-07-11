import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { OllamaVisionProvider, LlavaVisionProvider } from '../src/index.js';

describe('OllamaVisionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as unknown as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'A cat on a keyboard.' })
    });
  });

  it('defaults to the current-generation qwen3-vl model', async () => {
    const provider = new OllamaVisionProvider();
    await provider.describe({ prompt: 'What is this?', attachments: [] });
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
    expect(body.model).toBe('qwen3-vl');
    expect(body.stream).toBe(false);
  });

  it('accepts any vision-capable model', async () => {
    const provider = new OllamaVisionProvider({ model: 'gemma3' });
    await provider.describe({ prompt: 'Describe', attachments: [] });
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
    expect(body.model).toBe('gemma3');
  });

  it('strips data-URI prefixes from attachments', async () => {
    const provider = new OllamaVisionProvider();
    await provider.describe({
      prompt: 'What is this?',
      attachments: [{ data: 'data:image/jpeg;base64,AAAA' }, { data: 'BBBB' }]
    });
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
    expect(body.images).toEqual(['AAAA', 'BBBB']);
  });

  it('returns the model response', async () => {
    const provider = new OllamaVisionProvider();
    const result = await provider.describe({ prompt: 'p', attachments: [] });
    expect(result.content).toBe('A cat on a keyboard.');
  });

  it('throws with status and body on errors', async () => {
    (fetch as unknown as Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('model not found')
    });
    const provider = new OllamaVisionProvider();
    await expect(
      provider.describe({ prompt: 'p', attachments: [] })
    ).rejects.toThrow(/404.*model not found/);
  });
});

describe('LlavaVisionProvider (compat alias)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as unknown as Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'ok' })
    });
  });

  it('keeps the llava default model and its provider name', async () => {
    const provider = new LlavaVisionProvider();
    expect(provider.name).toBe('llava-vision');
    await provider.describe({ prompt: 'p', attachments: [] });
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
    expect(body.model).toBe('llava');
  });

  it('still honors an explicit model override', async () => {
    const provider = new LlavaVisionProvider({ model: 'llava:13b' });
    await provider.describe({ prompt: 'p', attachments: [] });
    const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
    expect(body.model).toBe('llava:13b');
  });
});
