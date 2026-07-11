import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import type { IncomingMessage } from 'http';
import { OpenAIRealtimeSTTProvider } from '../src/index.js';
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

function makeWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe('OpenAIRealtimeSTTProvider', () => {
  let server: WebSocketServer;
  let port: number;
  let received: Array<Record<string, unknown>>;
  let lastRequest: IncomingMessage | undefined;

  /**
   * Fake transcription-session endpoint: acks session.update, buffers
   * appends, and on commit emits word-by-word deltas plus a completed
   * event with the full transcript.
   */
  function startFakeRealtime(
    behavior?: (socket: WSClient, msg: Record<string, unknown>) => boolean
  ): Promise<void> {
    received = [];
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket, request) => {
      lastRequest = request;
      let appendedBytes = 0;
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(msg);
        if (behavior?.(socket as WSClient, msg)) return;
        if (msg.type === 'input_audio_buffer.append') {
          appendedBytes += Buffer.from(msg.audio as string, 'base64').length;
        } else if (msg.type === 'input_audio_buffer.commit') {
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'item_1',
              delta: 'Hello '
            })
          );
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.delta',
              item_id: 'item_1',
              delta: `world (${appendedBytes}b)`
            })
          );
          socket.send(
            JSON.stringify({
              type: 'conversation.item.input_audio_transcription.completed',
              item_id: 'item_1',
              transcript: `Hello world (${appendedBytes}b)`
            })
          );
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

  function makeProvider(overrides: Partial<{ model: string; language: string }> = {}) {
    return new OpenAIRealtimeSTTProvider({
      apiKey: 'sk-test',
      url: `ws://127.0.0.1:${port}`,
      ...overrides
    });
  }

  it('yields accumulating partials and a final transcript', async () => {
    await startFakeRealtime();
    const provider = makeProvider();

    const results = await collect(
      provider.transcribeStream(frames(Buffer.from('abcd'), Buffer.from('ef')))
    );

    expect(results.map((r) => [r.text, r.isFinal])).toEqual([
      ['Hello ', false],
      ['Hello world (6b)', false],
      ['Hello world (6b)', true]
    ]);
  });

  it('configures a transcription session with manual commit', async () => {
    await startFakeRealtime();
    const provider = makeProvider({ model: 'gpt-realtime-whisper', language: 'en' });

    await collect(provider.transcribeStream(frames(Buffer.from('x'))));

    expect(lastRequest?.headers.authorization).toBe('Bearer sk-test');
    const sessionUpdate = received[0];
    expect(sessionUpdate.type).toBe('session.update');
    expect(sessionUpdate.session).toEqual({
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-realtime-whisper', language: 'en' },
          turn_detection: null
        }
      }
    });
    // append then commit
    expect(received[1].type).toBe('input_audio_buffer.append');
    expect(received[1].audio).toBe(Buffer.from('x').toString('base64'));
    expect(received[2].type).toBe('input_audio_buffer.commit');
  });

  it('does not commit when no audio was sent', async () => {
    await startFakeRealtime();
    const provider = makeProvider();

    const results = await collect(provider.transcribeStream(frames()));

    expect(results).toEqual([]);
    expect(received.filter((m) => m.type === 'input_audio_buffer.commit')).toHaveLength(0);
  });

  it('surfaces transcription.failed events as thrown errors', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.commit') {
        socket.send(
          JSON.stringify({
            type: 'conversation.item.input_audio_transcription.failed',
            item_id: 'item_1',
            error: { type: 'transcription_error', message: 'audio unintelligible' }
          })
        );
        return true;
      }
      return false;
    });
    const provider = makeProvider();

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/transcription failed.*audio unintelligible/);
  });

  it('surfaces a server close without a final transcript as an error', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.commit') {
        socket.close();
        return true;
      }
      return false;
    });
    const provider = makeProvider();

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/closed before the final transcript/);
  });

  it('fails the stream when the final transcript never arrives (watchdog)', async () => {
    await startFakeRealtime((_socket, msg) => msg.type === 'input_audio_buffer.commit');
    const provider = new OpenAIRealtimeSTTProvider({
      apiKey: 'sk-test',
      url: `ws://127.0.0.1:${port}`,
      timeoutsMs: { final: 50 }
    });

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/timed out waiting for the final transcript/);
  });

  it('surfaces error events as thrown errors', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.commit') {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'buffer too small' }
          })
        );
        return true;
      }
      return false;
    });
    const provider = makeProvider();

    await expect(
      collect(provider.transcribeStream(frames(Buffer.from('x'))))
    ).rejects.toThrow(/buffer too small/);
  });

  it('transcribe() resamples a 16kHz WAV to 24kHz and returns the final result', async () => {
    await startFakeRealtime();
    const provider = makeProvider();
    // 1600 samples at 16kHz (100ms) -> 2400 samples = 4800 bytes at 24kHz
    const pcm16k = Buffer.alloc(1600 * 2);
    const result = await provider.transcribe(makeWav(pcm16k, 16000));

    expect(result.isFinal).toBe(true);
    expect(result.text).toBe('Hello world (4800b)');
  });

  it('transcribe() rejects non-WAV input with a clear message', async () => {
    await startFakeRealtime();
    const provider = makeProvider();

    await expect(provider.transcribe(Buffer.from('not a wav'))).rejects.toThrow(
      /expects a 16-bit mono PCM WAV/
    );
  });
});
