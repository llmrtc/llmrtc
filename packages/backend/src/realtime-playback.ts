/**
 * Realtime relay playback: an epoch-tagged audio queue drained by an
 * independent pacer task (RFC 0001 §3).
 *
 * Providers generate audio faster than realtime while the PCM feeder
 * plays it at wall-clock pace. The control loop must therefore never
 * await playback: it enqueues audio chunks synchronously here, and the
 * pacer - the only component that sleeps - drains them to the WebRTC
 * track. Barge-in is a synchronous clear(): bump the epoch, drop the
 * queue; chunks enqueued afterwards with a stale response id are
 * rejected by the caller (control loop) comparing response ids.
 */

import {
  createPCMFeederState,
  feedPCMChunkToSource,
  PCMFeederState
} from './mp3-decoder.js';
import type { WrtcAudioSource } from './wrtc-types.js';

interface PlaybackChunk {
  pcm: Buffer;
  epoch: number;
  itemId: string | undefined;
}

export class RealtimePlayback {
  private queue: PlaybackChunk[] = [];
  private waiter: (() => void) | null = null;
  private epoch = 0;
  private running = false;
  private stopped = false;
  private feederState: PCMFeederState = createPCMFeederState();
  private abort = new AbortController();
  private currentItemId: string | undefined;
  private itemFedMs = 0;
  private fedAnyThisEpoch = false;
  private drainPromise: Promise<void> = Promise.resolve();
  private drainedWaiters: Array<() => void> = [];

  constructor(
    private readonly source: WrtcAudioSource,
    private readonly inputSampleRate: number,
    private readonly onError?: (err: Error) => void
  ) {}

  /** Current playback epoch; bumped by clear(). */
  get currentEpoch(): number {
    return this.epoch;
  }

  /**
   * Milliseconds of the current output item fed to the WebRTC track -
   * the played-ms basis for barge-in truncation (RFC 0001 §4). Leads
   * what the user has heard by network + jitter buffer + playout.
   */
  get playedMsForCurrentItem(): number {
    return this.itemFedMs;
  }

  /** Whether any audio has been fed since the last clear(). */
  get audioFedThisEpoch(): boolean {
    return this.fedAnyThisEpoch;
  }

  /** Synchronous enqueue - called from the control loop, never blocks. */
  enqueue(pcm: Buffer, itemId?: string): void {
    if (this.stopped) return;
    this.queue.push({ pcm, epoch: this.epoch, itemId });
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w();
    }
    if (!this.running) {
      this.running = true;
      this.drainPromise = this.drain().catch((err: Error) => {
        this.onError?.(err);
      });
    }
  }

  /**
   * Barge-in: synchronously drop all queued audio and reset pacing.
   * Chunks of the cancelled response still in flight from the provider
   * are dropped on enqueue by the control loop (stale response id).
   */
  clear(): void {
    this.epoch++;
    this.queue = [];
    // Abort stops the in-flight chunk within one 10ms frame; a fresh
    // controller + feeder state start the new epoch clean
    this.abort.abort();
    this.abort = new AbortController();
    this.feederState.aborted = true;
    this.feederState = createPCMFeederState();
    this.currentItemId = undefined;
    this.itemFedMs = 0;
    this.fedAnyThisEpoch = false;
    this.notifyDrained();
  }

  /** Resolves once all currently queued audio has been fed (or cleared). */
  whenDrained(): Promise<void> {
    if (this.queue.length === 0 && !this.running) return Promise.resolve();
    return new Promise((resolve) => this.drainedWaiters.push(resolve));
  }

  private notifyDrained(): void {
    const waiters = this.drainedWaiters;
    this.drainedWaiters = [];
    for (const w of waiters) w();
  }

  /** Stop permanently (session teardown). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clear();
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w();
    }
    await this.drainPromise;
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const chunk = this.queue.shift();
      if (!chunk) {
        this.notifyDrained();
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
        continue;
      }
      // Stale chunks from before a clear() are silently dropped
      if (chunk.epoch !== this.epoch) continue;

      if (chunk.itemId !== this.currentItemId) {
        this.currentItemId = chunk.itemId;
        this.itemFedMs = 0;
      }

      const state = this.feederState;
      // Credit BEFORE feeding: audio is audibly on the track from the
      // first frame, so barge-in must see fedAnyThisEpoch immediately
      // (clear() resets it if it lands mid-feed)
      this.fedAnyThisEpoch = true;
      const msBefore = this.itemFedMs;
      await feedPCMChunkToSource(chunk.pcm, this.source, state, {
        inputSampleRate: this.inputSampleRate,
        signal: this.abort.signal
      });
      // Only credit the clock if this chunk wasn't invalidated mid-feed
      if (state === this.feederState && chunk.epoch === this.epoch) {
        this.itemFedMs = msBefore + chunk.pcm.length / ((this.inputSampleRate * 2) / 1000);
      }
    }
  }
}
