import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import type { IncomingMessage } from 'http';
import { OpenAIRealtimeSpeechProvider } from '../src/realtime-speech.js';
import type { RealtimeSpeechEvent, RealtimeSpeechSession } from '@llmrtc/llmrtc-core';

async function collectUntil(
  session: RealtimeSpeechSession,
  done: (events: RealtimeSpeechEvent[]) => boolean,
  timeoutMs = 2000
): Promise<RealtimeSpeechEvent[]> {
  const events: RealtimeSpeechEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  for await (const event of session.events()) {
    events.push(event);
    if (done(events)) break;
    if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(events)}`);
  }
  return events;
}

describe('OpenAIRealtimeSpeechProvider', () => {
  let server: WebSocketServer;
  let port: number;
  let received: Array<Record<string, unknown>>;
  let lastRequest: IncomingMessage | undefined;
  let serverSocket: WSClient | undefined;

  function startFakeRealtime(
    onMessage?: (socket: WSClient, msg: Record<string, unknown>) => void,
    opts: { expiresInSec?: number } = {}
  ): Promise<void> {
    received = [];
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket, request) => {
      lastRequest = request;
      serverSocket = socket as WSClient;
      socket.send(
        JSON.stringify({
          type: 'session.created',
          session: { expires_at: Math.floor(Date.now() / 1000) + (opts.expiresInSec ?? 3600) }
        })
      );
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(msg);
        onMessage?.(socket as WSClient, msg);
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

  function makeProvider(overrides: Partial<{ expiryLeadMs: number }> = {}) {
    return new OpenAIRealtimeSpeechProvider({
      apiKey: 'sk-test',
      url: `ws://127.0.0.1:${port}`,
      ...overrides
    });
  }

  it('connects with the model param and sends a full realtime session.update', async () => {
    await startFakeRealtime();
    const session = await makeProvider().connect({
      instructions: 'Be brief.',
      voice: 'marin',
      maxOutputTokens: 500
    });

    // Wait for the session.update to land
    await new Promise((r) => setTimeout(r, 50));
    expect(lastRequest?.headers.authorization).toBe('Bearer sk-test');
    const url = new URL(lastRequest!.url!, 'ws://localhost');
    expect(url.searchParams.get('model')).toBe('gpt-realtime-2.1');

    const update = received[0];
    expect(update.type).toBe('session.update');
    const sess = update.session as Record<string, unknown>;
    expect(sess.type).toBe('realtime');
    expect(sess.output_modalities).toEqual(['audio']);
    expect(sess.instructions).toBe('Be brief.');
    expect(sess.max_output_tokens).toBe(500);
    const audio = sess.audio as { input: Record<string, unknown>; output: Record<string, unknown> };
    expect(audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect((audio.output as Record<string, unknown>).format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(audio.input.transcription).toEqual({ model: 'gpt-4o-mini-transcribe' });
    expect(audio.input.turn_detection).toEqual({ type: 'server_vad' });
    expect(audio.output.voice).toBe('marin');
    // Relay-mode default context truncation comes from the server layer,
    // not the adapter; none was configured here
    expect(sess.truncation).toBeUndefined();

    await session.close();
  });

  it('maps provider events to normalized RealtimeSpeechEvents', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.append') {
        const pcm = Buffer.alloc(4800); // 100ms at 24kHz
        socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
        socket.send(JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }));
        socket.send(
          JSON.stringify({
            type: 'response.output_audio.delta',
            response_id: 'resp_1',
            item_id: 'item_1',
            content_index: 0,
            delta: pcm.toString('base64')
          })
        );
        socket.send(
          JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'Hello ' })
        );
        socket.send(
          JSON.stringify({ type: 'response.output_audio_transcript.done', transcript: 'Hello there.' })
        );
        socket.send(
          JSON.stringify({
            type: 'conversation.item.input_audio_transcription.completed',
            transcript: 'hi assistant'
          })
        );
        socket.send(
          JSON.stringify({
            type: 'response.done',
            response: {
              id: 'resp_1',
              usage: {
                input_tokens: 10,
                output_tokens: 20,
                input_token_details: { audio_tokens: 8, cached_tokens: 2 },
                output_token_details: { audio_tokens: 18 }
              }
            }
          })
        );
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(480));

    const events = await collectUntil(session, (e) => e.some((x) => x.type === 'response-done'));
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'user-speech-started',
      'response-started',
      'audio',
      'assistant-transcript',
      'assistant-transcript',
      'user-transcript',
      'response-done'
    ]);
    const audio = events.find((e) => e.type === 'audio') as Extract<RealtimeSpeechEvent, { type: 'audio' }>;
    expect(audio.responseId).toBe('resp_1');
    expect(audio.itemId).toBe('item_1');
    expect(audio.sampleRate).toBe(24000);
    expect(audio.pcm.length).toBe(4800);
    const done = events.find((e) => e.type === 'response-done') as Extract<
      RealtimeSpeechEvent,
      { type: 'response-done' }
    >;
    expect(done.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      audioInputTokens: 8,
      audioOutputTokens: 18,
      cachedTokens: 2
    });
    await session.close();
  });

  it('partial transcripts carry accumulated text, not fragments', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.append') {
        socket.send(JSON.stringify({ type: 'response.created', response: { id: 'r1' } }));
        socket.send(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'Hel' }));
        socket.send(JSON.stringify({ type: 'response.output_audio_transcript.delta', delta: 'lo there' }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'hi ' }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'friend' }));
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(480));

    const events = await collectUntil(
      session,
      (e) => e.filter((x) => x.type === 'user-transcript').length === 2
    );
    const assistant = events.filter((e) => e.type === 'assistant-transcript') as Array<
      Extract<RealtimeSpeechEvent, { type: 'assistant-transcript' }>
    >;
    expect(assistant.map((a) => a.text)).toEqual(['Hel', 'Hello there']);
    const user = events.filter((e) => e.type === 'user-transcript') as Array<
      Extract<RealtimeSpeechEvent, { type: 'user-transcript' }>
    >;
    expect(user.map((u) => u.text)).toEqual(['hi ', 'hi friend']);
    await session.close();
  });

  it('cancelResponse is a no-op with nothing active, and truncates clamped when active', async () => {
    await startFakeRealtime();
    const session = await makeProvider().connect({});
    await new Promise((r) => setTimeout(r, 30));
    received.length = 0;

    // Nothing active: safe no-op
    session.cancelResponse(1000);
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toHaveLength(0);

    // Start a response with 100ms of audio on item_1
    serverSocket!.send(JSON.stringify({ type: 'response.created', response: { id: 'resp_9' } }));
    serverSocket!.send(
      JSON.stringify({
        type: 'response.output_audio.delta',
        response_id: 'resp_9',
        item_id: 'item_9',
        content_index: 0,
        delta: Buffer.alloc(4800).toString('base64')
      })
    );
    await collectUntil(session, (e) => e.some((x) => x.type === 'audio'));

    // playedMs beyond received audio must be clamped to 100ms
    session.cancelResponse(5000);
    await new Promise((r) => setTimeout(r, 50));
    expect(received.map((m) => m.type)).toEqual(['response.cancel', 'conversation.item.truncate']);
    expect(received[1]).toMatchObject({
      item_id: 'item_9',
      content_index: 0,
      audio_end_ms: 100
    });
    await session.close();
  });

  it('swallows benign barge-in race errors and surfaces real ones', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.append') {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: { code: 'response_cancel_not_active', message: 'no active response' }
          })
        );
        socket.send(
          JSON.stringify({ type: 'error', error: { code: 'invalid_api_key', message: 'bad key' } })
        );
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(480));

    const events = await collectUntil(session, (e) => e.some((x) => x.type === 'error'));
    // Only ONE error event: the benign race was swallowed
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
    const err = events.find((e) => e.type === 'error') as Extract<RealtimeSpeechEvent, { type: 'error' }>;
    expect(err.error.message).toContain('bad key');
    expect(err.recoverable).toBe(false);
    await session.close();
  });

  it('emits session-expiring ahead of expires_at', async () => {
    await startFakeRealtime(undefined, { expiresInSec: 1 });
    // Lead larger than the lifetime: fires (almost) immediately
    const session = await makeProvider({ expiryLeadMs: 900 }).connect({});

    const events = await collectUntil(
      session,
      (e) => e.some((x) => x.type === 'session-expiring'),
      3000
    );
    const expiring = events.find((e) => e.type === 'session-expiring') as Extract<
      RealtimeSpeechEvent,
      { type: 'session-expiring' }
    >;
    expect(expiring.inMs).toBe(900);
    await session.close();
  });

  it('sendToolResult creates a function_call_output item and requests a response', async () => {
    await startFakeRealtime();
    const session = await makeProvider().connect({});
    await new Promise((r) => setTimeout(r, 30));
    received.length = 0;

    session.sendToolResult('call_7', { ok: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(received[0]).toMatchObject({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_7', output: '{"ok":true}' }
    });
    expect(received[1]).toEqual({ type: 'response.create' });
    await session.close();
  });

  it('fails the event stream when the socket drops unexpectedly', async () => {
    await startFakeRealtime((socket, msg) => {
      if (msg.type === 'input_audio_buffer.append') socket.close();
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(480));

    await expect(collectUntil(session, () => false, 1000)).rejects.toThrow(/closed unexpectedly/);
  });

  it('times out when the server never accepts the connection', async () => {
    // Point at a port with no listener
    await startFakeRealtime();
    const deadPort = port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    port = (server.address() as { port: number }).port;

    const provider = new OpenAIRealtimeSpeechProvider({
      apiKey: 'k',
      url: `ws://127.0.0.1:${deadPort}`,
      connectTimeoutMs: 300
    });
    await expect(provider.connect({})).rejects.toThrow(/connect failed|timed out/);
  });
});
