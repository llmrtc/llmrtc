import { describe, it, expect, vi } from 'vitest';
import { AsyncEventQueue } from '@llmrtc/llmrtc-core';
import type {
  RealtimeSpeechConfig,
  RealtimeSpeechEvent,
  RealtimeSpeechSession,
  ServerMessage
} from '@llmrtc/llmrtc-core';
import { RealtimePlayback } from '../src/realtime-playback.js';
import { RealtimeRelayOrchestrator } from '../src/realtime-relay-orchestrator.js';
import type { WrtcAudioSource } from '../src/wrtc-types.js';

class FakeSession implements RealtimeSpeechSession {
  readonly inputSampleRate = 24000;
  readonly outputSampleRate = 24000;
  readonly queue = new AsyncEventQueue<RealtimeSpeechEvent>();
  sentAudio: Buffer[] = [];
  cancelCalls: Array<number | undefined> = [];
  closed = false;

  events() {
    return this.queue;
  }
  sendAudio(frame: Buffer): void {
    this.sentAudio.push(frame);
  }
  cancelResponse(playedMs?: number): void {
    this.cancelCalls.push(playedMs);
  }
  sendToolResult(): void {}
  async update(_c: Partial<RealtimeSpeechConfig>): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
    this.queue.end();
  }
}

function makeFakeSource(): WrtcAudioSource & { frames: number } {
  const source = {
    frames: 0,
    onData() {
      source.frames++;
    },
    createTrack() {
      return {} as MediaStreamTrack;
    }
  };
  return source as unknown as WrtcAudioSource & { frames: number };
}

function setup() {
  const session = new FakeSession();
  const source = makeFakeSource();
  const playback = new RealtimePlayback(source, 24000);
  const sent: ServerMessage[] = [];
  const fatals: Error[] = [];
  const relay = new RealtimeRelayOrchestrator({
    session,
    playback,
    callbacks: {
      send: (m) => sent.push(m),
      onFatal: (e) => fatals.push(e)
    },
    logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  });
  return { session, source, playback, relay, sent, fatals };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

// 10ms of 24kHz mono 16-bit PCM
const pcm10ms = () => Buffer.alloc(480);

describe('RealtimeRelayOrchestrator', () => {
  it('relays transcripts and mirrors finals into history', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    session.queue.push({ type: 'user-transcript', text: 'hel', isFinal: false });
    session.queue.push({ type: 'user-transcript', text: 'hello there', isFinal: true });
    session.queue.push({ type: 'assistant-transcript', text: 'Hi! How can I help?', isFinal: true });
    session.queue.end();
    await done;

    expect(sent).toEqual([
      { type: 'transcript', text: 'hel', isFinal: false },
      { type: 'transcript', text: 'hello there', isFinal: true },
      { type: 'assistant-transcript', text: 'Hi! How can I help?', isFinal: true }
    ]);
    expect(relay.history).toEqual([
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: 'Hi! How can I help?' }
    ]);
  });

  it('gates tts-start on the first audio delta and completes with usage', async () => {
    const { session, relay, sent, source } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    await tick();
    // No audio yet: no tts-start (a tool-only response must not produce a phantom cycle)
    expect(sent.map((m) => m.type)).not.toContain('tts-start');

    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    session.queue.push({
      type: 'response-done',
      responseId: 'r1',
      usage: { inputTokens: 5, outputTokens: 9, audioOutputTokens: 7 }
    });
    session.queue.end();
    await done;
    await new Promise((r) => setTimeout(r, 100)); // let playback drain

    expect(sent.map((m) => m.type)).toEqual(['tts-start', 'usage', 'tts-complete']);
    expect(sent[1]).toMatchObject({ inputTokens: 5, outputTokens: 9, audioOutputTokens: 7 });
    expect(source.frames).toBeGreaterThan(0);
  });

  it('drops stale audio deltas of a cancelled response', async () => {
    const { session, relay, sent, source } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    await tick();
    session.queue.push({ type: 'user-speech-started' }); // barge-in
    await tick();
    const framesAfterBargeIn = source.frames;

    // Late deltas from the cancelled response keep arriving
    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    await tick();

    expect(source.frames).toBe(framesAfterBargeIn); // nothing new played
    expect(sent.filter((m) => m.type === 'tts-cancelled')).toHaveLength(1);
    expect(session.cancelCalls).toHaveLength(1);
    session.queue.end();
    await done;
  });

  it('clears playback on barge-in AFTER response-done while audio is still queued (B1)', async () => {
    const { session, relay, sent, source } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    // Generation faster than realtime: 500ms of audio arrives at once...
    for (let i = 0; i < 50; i++) {
      session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    }
    // ...and the response completes long before playback finishes
    session.queue.push({ type: 'response-done', responseId: 'r1' });
    await tick();
    const framesBefore = source.frames;
    expect(framesBefore).toBeLessThan(50);

    // User interrupts the still-playing tail
    session.queue.push({ type: 'user-speech-started' });
    await tick();
    await tick();

    expect(sent.filter((m) => m.type === 'tts-cancelled')).toHaveLength(1);
    expect(source.frames).toBeLessThanOrEqual(framesBefore + 2);
    // Response already done: no provider cancel
    expect(session.cancelCalls).toHaveLength(0);
    // tts-complete must NOT arrive later for the cancelled tail
    await tick();
    expect(sent.filter((m) => m.type === 'tts-complete')).toHaveLength(0);
    session.queue.end();
    await done;
  });

  it('barges in during the very first audio chunk (B2: credit before feed)', async () => {
    const { session, relay, sent, source } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    // One large 500ms delta - playback is mid-feed for a while
    session.queue.push({
      type: 'audio',
      pcm: Buffer.alloc(480 * 50),
      sampleRate: 24000,
      responseId: 'r1',
      itemId: 'i1'
    });
    await tick(); // ~20ms in: audio audible, chunk still feeding

    session.queue.push({ type: 'user-speech-started' });
    await tick();
    const framesAtBargeIn = source.frames;

    expect(sent.filter((m) => m.type === 'tts-cancelled')).toHaveLength(1);
    expect(session.cancelCalls).toHaveLength(1);
    // The in-flight chunk must stop within ~a frame or two, not run 500ms
    await new Promise((r) => setTimeout(r, 100));
    expect(source.frames).toBeLessThanOrEqual(framesAtBargeIn + 2);
    session.queue.end();
    await done;
  });

  it('drops audio events for a response that never started', async () => {
    const { session, relay, sent, source } = setup();
    const done = relay.start();

    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'ghost', itemId: 'i1' });
    session.queue.end();
    await done;
    await tick();

    expect(source.frames).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('defers tts-complete until queued audio finishes playing', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    for (let i = 0; i < 8; i++) {
      session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    }
    session.queue.push({ type: 'response-done', responseId: 'r1' });
    await tick();
    // 80ms of audio: completion must not have been sent yet
    expect(sent.filter((m) => m.type === 'tts-complete')).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 150));
    expect(sent.filter((m) => m.type === 'tts-complete')).toHaveLength(1);
    session.queue.end();
    await done;
  });

  it('relays speech-end and measures response latency', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    session.queue.push({ type: 'user-speech-stopped' });
    session.queue.push({ type: 'response-started', responseId: 'r1' });
    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    session.queue.end();
    await done;

    expect(sent.map((m) => m.type)).toContain('speech-end');
    session.queue.end();
  });

  it('cancels an active silent response on speech-start without touching playback', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    // Response active but no audio yet (pre-first-delta window)
    session.queue.push({ type: 'response-started', responseId: 'r1' });
    session.queue.push({ type: 'user-speech-started' });
    session.queue.end();
    await done;

    // Provider cancel fires (response was active); nothing audible, so
    // no tts-cancelled reaches the client
    expect(sent.map((m) => m.type)).toEqual(['speech-start']);
    expect(session.cancelCalls).toHaveLength(1);
  });

  it('does nothing on speech-start between responses (tool execution race)', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    session.queue.push({ type: 'response-done', responseId: 'r1' });
    session.queue.push({ type: 'user-speech-started' });
    session.queue.end();
    await done;

    expect(sent.map((m) => m.type)).toEqual(['speech-start']);
    expect(session.cancelCalls).toHaveLength(0);
  });

  it('clears playback on provider-driven interruption (Gemini)', async () => {
    const { session, relay, sent } = setup();
    const done = relay.start();

    session.queue.push({ type: 'response-started', responseId: 'r1' });
    session.queue.push({ type: 'audio', pcm: pcm10ms(), sampleRate: 24000, responseId: 'r1', itemId: 'i1' });
    await tick();
    session.queue.push({ type: 'interrupted' });
    await tick();

    expect(sent.filter((m) => m.type === 'tts-cancelled')).toHaveLength(1);
    // Provider-driven: no client-driven cancel sent back
    expect(session.cancelCalls).toHaveLength(0);
    session.queue.end();
    await done;
  });

  it('routes fatal provider errors to onFatal', async () => {
    const { session, relay, fatals } = setup();
    const done = relay.start();

    session.queue.push({ type: 'error', error: new Error('auth failed'), recoverable: false });
    session.queue.end();
    await done;

    expect(fatals).toHaveLength(1);
    expect(fatals[0].message).toBe('auth failed');
  });

  it('stop() closes the provider session and ends the loop', async () => {
    const { session, relay } = setup();
    const done = relay.start();
    session.queue.push({ type: 'response-started', responseId: 'r1' });
    await tick();

    await relay.stop();
    expect(session.closed).toBe(true);
    await done;
  });
});

describe('RealtimePlayback', () => {
  it('paces audio to the source and tracks per-item played ms', async () => {
    const source = makeFakeSource();
    const playback = new RealtimePlayback(source, 24000);

    playback.enqueue(pcm10ms(), 'item-1');
    playback.enqueue(pcm10ms(), 'item-1');
    await new Promise((r) => setTimeout(r, 80));

    expect(source.frames).toBeGreaterThanOrEqual(2);
    expect(playback.playedMsForCurrentItem).toBe(20);
    expect(playback.audioFedThisEpoch).toBe(true);

    // New item resets the clock
    playback.enqueue(pcm10ms(), 'item-2');
    await new Promise((r) => setTimeout(r, 60));
    expect(playback.playedMsForCurrentItem).toBe(10);
    await playback.stop();
  });

  it('clear() drops queued audio immediately', async () => {
    const source = makeFakeSource();
    const playback = new RealtimePlayback(source, 24000);

    // Queue 500ms of audio (arrives faster than realtime)
    for (let i = 0; i < 50; i++) playback.enqueue(pcm10ms(), 'item-1');
    await new Promise((r) => setTimeout(r, 40));
    const framesBefore = source.frames;
    expect(framesBefore).toBeLessThan(50); // still paced, most is queued

    playback.clear();
    await new Promise((r) => setTimeout(r, 100));
    // At most one in-flight chunk after clear; the queue was dropped
    expect(source.frames).toBeLessThanOrEqual(framesBefore + 1);
    expect(playback.audioFedThisEpoch).toBe(false);
    expect(playback.playedMsForCurrentItem).toBe(0);
    await playback.stop();
  });
});
