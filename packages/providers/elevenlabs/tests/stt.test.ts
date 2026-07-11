import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import type { IncomingMessage } from 'http';
import { ElevenLabsScribeProvider } from '../src/index.js';
import type { STTResult } from '@llmrtc/llmrtc-core';

async function* frames(...chunks: Buffer[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect(gen: AsyncIterable<STTResult>): Promise<STTResult[]> {
  const items: STTResult[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('ElevenLabsScribeProvider batch transcribe()', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'hello from scribe', language_code: 'en' })
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts multipart form data with scribe_v2 by default', async () => {
    const provider = new ElevenLabsScribeProvider({ apiKey: 'xi-key' });
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40), Buffer.from('WAVE-data')]);

    const result = await provider.transcribe(wav);

    expect(result).toMatchObject({ text: 'hello from scribe', isFinal: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.headers['xi-api-key']).toBe('xi-key');
    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect((form.get('file') as Blob).size).toBe(wav.length);
  });

  it('honors model and language overrides', async () => {
    const provider = new ElevenLabsScribeProvider({
      apiKey: 'k',
      modelId: 'scribe_v1',
      languageCode: 'de'
    });

    await provider.transcribe(Buffer.from('data'), { model: 'scribe_v2', language: 'fr' });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('language_code')).toBe('fr');
  });

  it('throws with status and body on errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid api key')
    });
    const provider = new ElevenLabsScribeProvider({ apiKey: 'bad' });

    await expect(provider.transcribe(Buffer.from('x'))).rejects.toThrow(/401.*invalid api key/);
  });
});

describe('ElevenLabsScribeProvider transcribeStream()', () => {
  let server: WebSocketServer;
  let port: number;
  let received: Array<Record<string, unknown>>;
  let lastRequest: IncomingMessage | undefined;

  /** Fake Scribe realtime endpoint: partials per chunk, committed on commit. */
  function startFakeScribe(
    behavior?: (socket: WSClient, msg: Record<string, unknown>) => boolean
  ): Promise<void> {
    received = [];
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket, request) => {
      lastRequest = request;
      socket.send(JSON.stringify({ message_type: 'session_started', session_id: 's1' }));
      let text = '';
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(msg);
        if (behavior?.(socket as WSClient, msg)) return;
        if (msg.message_type === 'input_audio_chunk') {
          if (msg.audio_base_64) {
            text += Buffer.from(msg.audio_base_64 as string, 'base64').toString();
            socket.send(JSON.stringify({ message_type: 'partial_transcript', text }));
          }
          if (msg.commit) {
            socket.send(JSON.stringify({ message_type: 'committed_transcript', text }));
          }
        }
      });
    });
    return new Promise((resolve) => {
      server.on('listening', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeProvider(): ElevenLabsScribeProvider {
    return new ElevenLabsScribeProvider({
      apiKey: 'xi-key',
      wsBaseUrl: `ws://127.0.0.1:${port}`
    });
  }

  it('does not commit when no audio frames were produced', async () => {
    await startFakeScribe();
    const provider = makeProvider();

    const results = await collect(provider.transcribeStream(frames()));

    expect(results).toEqual([]);
    expect(received.filter((m) => m.commit === true)).toHaveLength(0);
  });

  it('fails the stream when the final transcript never arrives (watchdog)', async () => {
    await startFakeScribe((_socket, msg) => msg.commit === true); // swallow the commit
    const provider = new ElevenLabsScribeProvider({
      apiKey: 'xi-key',
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      timeoutsMs: { final: 50 }
    });

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/timed out waiting for the final transcript/);
  });

  it('streams partials and ends on the committed transcript', async () => {
    await startFakeScribe();
    const provider = makeProvider();

    const results = await collect(
      provider.transcribeStream(frames(Buffer.from('hello '), Buffer.from('world')))
    );

    expect(results.map((r) => [r.text, r.isFinal])).toEqual([
      ['hello ', false],
      ['hello world', false],
      ['hello world', true]
    ]);
  });

  it('sends the documented wire format and closing commit', async () => {
    await startFakeScribe();
    const provider = makeProvider();

    await collect(provider.transcribeStream(frames(Buffer.from('abc'))));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: Buffer.from('abc').toString('base64'),
      commit: false,
      sample_rate: 16000
    });
    expect(received[1]).toMatchObject({
      message_type: 'input_audio_chunk',
      audio_base_64: '',
      commit: true
    });
  });

  it('authenticates with the xi-api-key header and passes query params', async () => {
    await startFakeScribe();
    const provider = new ElevenLabsScribeProvider({
      apiKey: 'xi-secret',
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      languageCode: 'en'
    });

    await collect(provider.transcribeStream(frames(Buffer.from('x'))));

    expect(lastRequest?.headers['xi-api-key']).toBe('xi-secret');
    const url = new URL(lastRequest!.url!, 'ws://localhost');
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('commit_strategy')).toBe('manual');
    expect(url.searchParams.get('language_code')).toBe('en');
  });

  it('surfaces server error events as thrown errors', async () => {
    await startFakeScribe((socket, msg) => {
      if (msg.message_type === 'input_audio_chunk') {
        socket.send(JSON.stringify({ message_type: 'quota_exceeded', error: 'out of credits' }));
        return true;
      }
      return false;
    });
    const provider = makeProvider();

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/quota_exceeded.*out of credits/);
  });

  it('surfaces a server close without a final transcript as an error', async () => {
    await startFakeScribe((socket, msg) => {
      if (msg.commit) {
        socket.close();
        return true;
      }
      return false;
    });
    const provider = makeProvider();

    // The utterance was lost - the turn must fail loudly, not produce an
    // empty transcript that silently drops what the user said
    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('hi'))))
    ).rejects.toThrow(/closed before the final transcript/);
  });
});
