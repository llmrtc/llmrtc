import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import {
  LLMRTCServer,
  type LLMProvider,
  type STTProvider,
  type TTSProvider,
  type LLMRequest,
  type LLMChunk,
  type STTResult
} from '../src/index.js';

class SlowStreamingLLM implements LLMProvider {
  name = 'slow-llm';
  active = 0;
  maxActive = 0;
  streamStarts = 0;

  async complete(_req: LLMRequest) {
    return { fullText: 'ok' };
  }

  async *stream(_req: LLMRequest): AsyncIterable<LLMChunk> {
    this.active++;
    this.streamStarts++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      for (const word of ['one ', 'two ', 'three ', 'four ', 'five.']) {
        await new Promise(r => setTimeout(r, 15));
        yield { content: word, done: false };
      }
      yield { content: '', done: true };
    } finally {
      this.active--;
    }
  }
}

class InstantSTT implements STTProvider {
  name = 'instant-stt';
  async transcribe(_audio: Buffer): Promise<STTResult> {
    return { text: 'hello there', isFinal: true };
  }
}

class InstantTTS implements TTSProvider {
  name = 'instant-tts';
  async speak(text: string) {
    return { audio: Buffer.from(`audio:${text}`), format: 'mp3' as const };
  }
  async *speakStream(_text: string): AsyncIterable<Buffer> {
    yield Buffer.from('pcm-data');
  }
}

interface TestContext {
  server: LLMRTCServer;
  port: number;
  llm: SlowStreamingLLM;
}

async function startTestServer(): Promise<TestContext> {
  const llm = new SlowStreamingLLM();
  const server = new LLMRTCServer({
    providers: { llm, stt: new InstantSTT(), tts: new InstantTTS() },
    port: 0,
    host: '127.0.0.1'
  });
  await server.start();
  const port = (server.getServer()!.address() as AddressInfo).port;
  return { server, port, llm };
}

interface WsClient {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
}

function connectClient(port: number): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: Array<Record<string, unknown>> = [];
    const waiters: Array<{ type: string; resolve: (msg: Record<string, unknown>) => void }> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].type === msg.type) {
          waiters[i].resolve(msg);
          waiters.splice(i, 1);
        }
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitFor: (type, timeoutMs = 5000) => {
          const existing = messages.find(m => m.type === type);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(
              () => rej(new Error(`Timed out waiting for message type '${type}'`)),
              timeoutMs
            );
            waiters.push({
              type,
              resolve: (msg) => {
                clearTimeout(timer);
                res(msg);
              }
            });
          });
        },
        close: () => ws.close()
      });
    });
    ws.on('error', reject);
  });
}

describe('LLMRTCServer behavior', () => {
  let ctx: TestContext | null = null;

  afterEach(async () => {
    if (ctx) {
      await ctx.server.stop();
      ctx = null;
    }
  });

  it('sends a ready message with a session id and ice servers', async () => {
    ctx = await startTestServer();
    const client = await connectClient(ctx.port);
    const ready = await client.waitFor('ready');
    expect(ready.id).toBeTruthy();
    expect(Array.isArray(ready.iceServers)).toBe(true);
    client.close();
  });

  it('acks reconnect with success:false for unknown session ids', async () => {
    ctx = await startTestServer();
    const client = await connectClient(ctx.port);
    const ready = await client.waitFor('ready');

    client.ws.send(JSON.stringify({ type: 'reconnect', sessionId: 'no-such-session' }));
    const ack = await client.waitFor('reconnect-ack');

    expect(ack.success).toBe(false);
    expect(ack.historyRecovered).toBe(false);
    // The client keeps its current session rather than adopting the bogus id
    expect(ack.sessionId).toBe(ready.id);
    client.close();
  });

  it('recovers a known session with success:true', async () => {
    ctx = await startTestServer();
    const first = await connectClient(ctx.port);
    const firstReady = await first.waitFor('ready');
    first.close();

    const second = await connectClient(ctx.port);
    await second.waitFor('ready');
    second.ws.send(JSON.stringify({ type: 'reconnect', sessionId: firstReady.id }));
    const ack = await second.waitFor('reconnect-ack');

    expect(ack.success).toBe(true);
    expect(ack.historyRecovered).toBe(true);
    expect(ack.sessionId).toBe(firstReady.id);
    second.close();
  });

  it('serializes turns and aborts the previous one on a new utterance', async () => {
    ctx = await startTestServer();
    const client = await connectClient(ctx.port);
    await client.waitFor('ready');

    const audio = Buffer.from('fake-audio').toString('base64');
    client.ws.send(JSON.stringify({ type: 'audio', data: audio }));
    // Second utterance arrives while the first turn is mid-LLM
    await new Promise(r => setTimeout(r, 30));
    client.ws.send(JSON.stringify({ type: 'audio', data: audio }));

    // Wait for the second turn to finish
    await client.waitFor('llm', 10000);

    // Both turns ran, but never concurrently
    expect(ctx.llm.streamStarts).toBe(2);
    expect(ctx.llm.maxActive).toBe(1);
    client.close();
  });

  it('rejects start() when the port is in use', async () => {
    ctx = await startTestServer();
    const conflicting = new LLMRTCServer({
      providers: {
        llm: new SlowStreamingLLM(),
        stt: new InstantSTT(),
        tts: new InstantTTS()
      },
      port: ctx.port,
      host: '127.0.0.1'
    });
    await expect(conflicting.start()).rejects.toThrow(/EADDRINUSE/);
  });

  it('stop() releases resources and nulls the server handles', async () => {
    const local = await startTestServer();
    await local.server.stop();
    expect(local.server.getServer()).toBeNull();
    expect(local.server.getApp()).toBeNull();
  });
});
