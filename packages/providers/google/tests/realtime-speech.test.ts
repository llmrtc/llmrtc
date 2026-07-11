import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import { GeminiLiveSpeechProvider } from '../src/realtime-speech.js';
import type { RealtimeSpeechEvent, RealtimeSpeechSession } from '@llmrtc/llmrtc-core';

async function collectUntil(
  session: RealtimeSpeechSession,
  done: (events: RealtimeSpeechEvent[]) => boolean,
  timeoutMs = 3000
): Promise<RealtimeSpeechEvent[]> {
  const events: RealtimeSpeechEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  for await (const event of session.events()) {
    events.push(event);
    if (done(events)) break;
    if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(events.map((e) => e.type))}`);
  }
  return events;
}

describe('GeminiLiveSpeechProvider', () => {
  let server: WebSocketServer;
  let port: number;
  let received: Array<Record<string, unknown>>;
  let connections = 0;
  let sockets: WSClient[] = [];

  let manualSetupAck = false;

  function startFakeGemini(
    onMessage?: (socket: WSClient, msg: Record<string, unknown>, connIndex: number) => void,
    opts: { manualSetupAck?: boolean } = {}
  ): Promise<void> {
    manualSetupAck = opts.manualSetupAck ?? false;
    received = [];
    connections = 0;
    sockets = [];
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket) => {
      const connIndex = connections++;
      sockets.push(socket as WSClient);
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(msg);
        if (msg.setup && !manualSetupAck) {
          socket.send(JSON.stringify({ setupComplete: {} }));
          socket.send(JSON.stringify({ sessionResumptionUpdate: { newHandle: `h-${connIndex}`, resumable: true } }));
        }
        onMessage?.(socket as WSClient, msg, connIndex);
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
    for (const socket of sockets) {
      try {
        socket.terminate();
      } catch {
        // already closed
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeProvider() {
    return new GeminiLiveSpeechProvider({
      apiKey: 'g-key',
      url: `ws://127.0.0.1:${port}`,
      connectTimeoutMs: 2000
    });
  }

  it('sends a spec-shaped setup message and audio frames', async () => {
    await startFakeGemini();
    const session = await makeProvider().connect({
      instructions: 'Be brief.',
      voice: 'Kore',
      tools: [{ name: 'f', description: 'd', parameters: { type: 'object', properties: {} } }]
    });
    session.sendAudio(Buffer.from('pcm'));
    await new Promise((r) => setTimeout(r, 80));

    const setup = received[0].setup as Record<string, unknown>;
    expect(setup.model).toBe('models/gemini-3.1-flash-live-preview');
    expect((setup.generationConfig as Record<string, unknown>).responseModalities).toEqual(['AUDIO']);
    expect(setup.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.contextWindowCompression).toMatchObject({ slidingWindow: {} });
    expect(setup.sessionResumption).toEqual({});
    expect((setup.tools as unknown[])[0]).toMatchObject({
      functionDeclarations: [{ name: 'f' }]
    });
    const audioMsg = received.find((m) => m.realtimeInput) as Record<string, unknown>;
    expect(audioMsg.realtimeInput).toEqual({
      audio: { data: Buffer.from('pcm').toString('base64'), mimeType: 'audio/pcm;rate=16000' }
    });
    await session.close();
  });

  it('normalizes model turns, transcripts, interruption and tool calls', async () => {
    await startFakeGemini((socket, msg) => {
      if (msg.realtimeInput) {
        socket.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'hi ' } } }));
        socket.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'there' } } }));
        socket.send(
          JSON.stringify({
            serverContent: {
              modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(480).toString('base64') } }] },
              outputTranscription: { text: 'Hello!' }
            }
          })
        );
        socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
        socket.send(
          JSON.stringify({ toolCall: { functionCalls: [{ id: 'c1', name: 'f', args: { a: 1 } }] } })
        );
        socket.send(JSON.stringify({ serverContent: { interrupted: true } }));
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(320));

    const events = await collectUntil(session, (e) => e.some((x) => x.type === 'interrupted'));
    const types = events.map((e) => e.type);
    expect(types).toContain('response-started');
    expect(types).toContain('response-done');
    expect(types).toContain('tool-call');
    // Cumulative partials
    const userPartials = events.filter((e) => e.type === 'user-transcript');
    expect(userPartials.map((u) => u.text)).toEqual(['hi ', 'hi there', 'hi there']);
    expect(userPartials[2].isFinal).toBe(true); // finalized when the model turn began
    const assistant = events.filter((e) => e.type === 'assistant-transcript');
    expect(assistant[assistant.length - 1]).toMatchObject({ text: 'Hello!', isFinal: true });
    const audio = events.find((e) => e.type === 'audio') as Extract<RealtimeSpeechEvent, { type: 'audio' }>;
    expect(audio.sampleRate).toBe(24000);
    expect(audio.responseId).toBe('turn-1');
    const tool = events.find((e) => e.type === 'tool-call') as Extract<RealtimeSpeechEvent, { type: 'tool-call' }>;
    expect(tool).toMatchObject({ callId: 'c1', name: 'f', arguments: { a: 1 } });
    await session.close();
  });

  it('reconnects on goAway with the resumption handle and replays buffered audio', async () => {
    await startFakeGemini((socket, msg, connIndex) => {
      if (msg.realtimeInput && connIndex === 0) {
        socket.send(JSON.stringify({ goAway: { timeLeft: '5s' } }));
        // Server closes shortly after goAway
        setTimeout(() => socket.close(), 30);
      }
    });
    const session = await makeProvider().connect({ instructions: 'x' });
    session.sendAudio(Buffer.from('frame-1'));
    await new Promise((r) => setTimeout(r, 20));
    // Frames sent during the reconnect window are buffered
    session.sendAudio(Buffer.from('frame-2'));
    session.sendAudio(Buffer.from('frame-3'));

    const events = await collectUntil(session, (e) => e.some((x) => x.type === 'session-expiring'));
    expect(
      (events.find((e) => e.type === 'session-expiring') as { inMs?: number }).inMs
    ).toBe(5000);
    await new Promise((r) => setTimeout(r, 300));

    expect(connections).toBe(2);
    const secondSetup = received.filter((m) => m.setup).map((m) => m.setup as Record<string, unknown>)[1];
    expect(secondSetup.sessionResumption).toEqual({ handle: 'h-0' });
    // Buffered frames replayed on the new socket
    const audioPayloads = received
      .filter((m) => m.realtimeInput)
      .map((m) => Buffer.from(
        ((m.realtimeInput as Record<string, { data: string }>).audio).data,
        'base64'
      ).toString());
    expect(audioPayloads).toEqual(['frame-1', 'frame-2', 'frame-3']);
    await session.close();
  });

  it('sends tool results in toolResponse shape', async () => {
    await startFakeGemini();
    const session = await makeProvider().connect({});
    await new Promise((r) => setTimeout(r, 50));
    received.length = 0;

    session.sendToolResult('c9', { temp: 22 });
    await new Promise((r) => setTimeout(r, 50));
    expect(received[0]).toEqual({
      toolResponse: { functionResponses: [{ id: 'c9', response: { temp: 22 } }] }
    });
    await session.close();
  });

  it('updates instructions via a system text turn without reconnecting', async () => {
    await startFakeGemini();
    const session = await makeProvider().connect({ instructions: 'old' });
    await new Promise((r) => setTimeout(r, 50));
    received.length = 0;

    await session.update({ instructions: 'new stage prompt' });
    await new Promise((r) => setTimeout(r, 50));

    expect(connections).toBe(1); // no reconnect
    expect(received[0]).toMatchObject({
      clientContent: { turns: [{ role: 'system', parts: [{ text: 'new stage prompt' }] }] }
    });
    await session.close();
  });

  it('reconnects (with handle) when the tool set changes', async () => {
    await startFakeGemini();
    const session = await makeProvider().connect({ instructions: 'x' });
    await new Promise((r) => setTimeout(r, 50));

    await session.update({
      tools: [{ name: 'g', description: 'd', parameters: { type: 'object', properties: {} } }]
    });
    await new Promise((r) => setTimeout(r, 100));

    expect(connections).toBe(2);
    const setups = received.filter((m) => m.setup).map((m) => m.setup as Record<string, unknown>);
    expect(setups[1].sessionResumption).toEqual({ handle: 'h-0' });
    expect((setups[1].tools as unknown[])[0]).toMatchObject({ functionDeclarations: [{ name: 'g' }] });
    await session.close();
  });

  it('rotates resumption handles across two goAway reconnects', async () => {
    await startFakeGemini((socket, msg, connIndex) => {
      if (msg.realtimeInput && connIndex < 2) {
        socket.send(JSON.stringify({ goAway: {} })); // no timeLeft: must not crash
        setTimeout(() => socket.close(), 20);
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.from('a'));
    await new Promise((r) => setTimeout(r, 250));
    session.sendAudio(Buffer.from('b'));
    await new Promise((r) => setTimeout(r, 400));

    expect(connections).toBe(3);
    const setups = received.filter((m) => m.setup).map((m) => m.setup as Record<string, unknown>);
    expect(setups[1].sessionResumption).toEqual({ handle: 'h-0' });
    // Second reconnect resumes with the SECOND connection's handle
    expect(setups[2].sessionResumption).toEqual({ handle: 'h-1' });
    await session.close();
  });

  it('close() during an in-flight reconnect leaves no surviving connection', async () => {
    let releaseSecondConn: (() => void) | null = null;
    await startFakeGemini(
      (socket, msg, connIndex) => {
        if (msg.setup && connIndex === 0) {
          socket.send(JSON.stringify({ setupComplete: {} }));
          socket.send(JSON.stringify({ sessionResumptionUpdate: { newHandle: 'h-0', resumable: true } }));
        }
        if (msg.realtimeInput && connIndex === 0) {
          socket.send(JSON.stringify({ goAway: { timeLeft: '1s' } }));
          setTimeout(() => socket.close(), 10);
        }
        if (msg.setup && connIndex > 0) {
          // Hold the second connection's setupComplete until after close()
          releaseSecondConn = () => socket.send(JSON.stringify({ setupComplete: {} }));
        }
      },
      { manualSetupAck: true }
    );
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.from('x'));
    await new Promise((r) => setTimeout(r, 150)); // reconnect in flight
    const closePromise = session.close();
    releaseSecondConn?.();
    await closePromise;
    await new Promise((r) => setTimeout(r, 100));

    // Every socket the adapter opened is closed or closing
    for (const socket of sockets) {
      expect([WSClient.CLOSED, WSClient.CLOSING]).toContain(socket.readyState);
    }
  });

  it('reports usage on response-done and starts a fresh turn after interruption', async () => {
    await startFakeGemini((socket, msg) => {
      if (msg.realtimeInput) {
        socket.send(
          JSON.stringify({
            serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(48).toString('base64') } }] } }
          })
        );
        socket.send(JSON.stringify({ serverContent: { interrupted: true } }));
        socket.send(
          JSON.stringify({
            usageMetadata: {
              promptTokenCount: 11,
              responseTokenCount: 22,
              responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 20 }]
            }
          })
        );
        socket.send(
          JSON.stringify({
            serverContent: { modelTurn: { parts: [{ inlineData: { data: Buffer.alloc(48).toString('base64') } }] } }
          })
        );
        socket.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
    });
    const session = await makeProvider().connect({});
    session.sendAudio(Buffer.alloc(32));

    const events = await collectUntil(
      session,
      (e) => e.filter((x) => x.type === 'response-done').length === 2
    );
    const starts = events.filter((e) => e.type === 'response-started');
    expect(starts.map((s) => (s as { responseId: string }).responseId)).toEqual(['turn-1', 'turn-2']);
    // Interrupted turn is closed with response-done (no dangling state)
    const dones = events.filter((e) => e.type === 'response-done') as Array<
      Extract<RealtimeSpeechEvent, { type: 'response-done' }>
    >;
    expect(dones[0].responseId).toBe('turn-1');
    expect(dones[1].usage).toMatchObject({ inputTokens: 11, outputTokens: 22, audioOutputTokens: 20 });
    await session.close();
  });

  it('fails the stream when reconnect cannot be established', async () => {
    await startFakeGemini((socket, msg, connIndex) => {
      if (msg.realtimeInput && connIndex === 0) {
        setTimeout(() => {
          socket.close();
          // Take the whole server down so reconnect fails
          server.close();
        }, 10);
      }
    });
    const provider = new GeminiLiveSpeechProvider({
      apiKey: 'g',
      url: `ws://127.0.0.1:${port}`,
      connectTimeoutMs: 300
    });
    const session = await provider.connect({});
    session.sendAudio(Buffer.alloc(32));

    await expect(collectUntil(session, () => false, 3000)).rejects.toThrow(/reconnect failed/);
  });
});
