/**
 * Realtime relay orchestrator (RFC 0001 §3-§4, experimental).
 *
 * Consumes the provider session's control stream in a single loop that
 * never awaits playback: audio events are handed synchronously to
 * RealtimePlayback (drained by its own pacer), everything else is
 * handled immediately - protocol messages, barge-in, transcript
 * mirroring, hooks/metrics.
 *
 * Not a TurnOrchestrator: turns are provider-driven, so there is no
 * per-turn generator to run. The server starts the loop once per
 * connection and stops it on teardown.
 */

import {
  Message,
  MetricsAdapter,
  NoopMetrics,
  RealtimeSpeechEvent,
  RealtimeSpeechSession,
  ServerMessage
} from '@llmrtc/llmrtc-core';
import { RealtimePlayback } from './realtime-playback.js';

export interface RealtimeRelayCallbacks {
  /** Send a protocol message to the client over ws + datachannel. */
  send(message: ServerMessage): void;
  /** Fatal relay failure: the server ends the session. */
  onFatal(error: Error): void;
}

export interface RealtimeRelayOptions {
  session: RealtimeSpeechSession;
  playback: RealtimePlayback;
  callbacks: RealtimeRelayCallbacks;
  metrics?: MetricsAdapter;
  logger?: Pick<Console, 'warn' | 'error' | 'debug'>;
}

export class RealtimeRelayOrchestrator {
  /** Mirrored conversation history (final transcripts), RFC 0001 §3. */
  readonly history: Message[] = [];

  private readonly session: RealtimeSpeechSession;
  private readonly playback: RealtimePlayback;
  private readonly callbacks: RealtimeRelayCallbacks;
  private readonly metrics: MetricsAdapter;
  private readonly logger: Pick<Console, 'warn' | 'error' | 'debug'>;

  private activeResponseId: string | null = null;
  private ttsStartedForResponse: string | null = null;
  private stopped = false;
  private speechStoppedAt: number | null = null;
  private loopPromise: Promise<void> = Promise.resolve();

  constructor(options: RealtimeRelayOptions) {
    this.session = options.session;
    this.playback = options.playback;
    this.callbacks = options.callbacks;
    this.metrics = options.metrics ?? new NoopMetrics();
    this.logger = options.logger ?? console;
  }

  /** Begin consuming the provider control stream. Resolves on stream end. */
  start(): Promise<void> {
    this.loopPromise = this.run();
    return this.loopPromise;
  }

  /** Feed a mic PCM frame (already at the session's input rate). */
  sendAudio(frame: Buffer): void {
    if (!this.stopped) {
      this.session.sendAudio(frame);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.playback.stop();
    await this.session.close();
    await this.loopPromise.catch(() => {});
  }

  private async run(): Promise<void> {
    try {
      for await (const event of this.session.events()) {
        if (this.stopped) break;
        this.handleEvent(event);
      }
    } catch (error) {
      if (!this.stopped) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error('[realtime-relay] provider stream failed:', err.message);
        this.callbacks.onFatal(err);
      }
    }
  }

  /** Synchronous: nothing in here may await playback. */
  private handleEvent(event: RealtimeSpeechEvent): void {
    switch (event.type) {
      case 'audio': {
        // Stale deltas of a cancelled response are dropped here
        if (event.responseId !== this.activeResponseId) return;
        if (this.ttsStartedForResponse !== event.responseId) {
          this.ttsStartedForResponse = event.responseId;
          this.callbacks.send({ type: 'tts-start' });
          if (this.speechStoppedAt) {
            this.metrics.timing('realtime.response_latency', Date.now() - this.speechStoppedAt);
            this.speechStoppedAt = null;
          }
        }
        this.playback.enqueue(event.pcm, event.itemId);
        break;
      }
      case 'response-started':
        this.activeResponseId = event.responseId;
        break;
      case 'response-done': {
        if (this.activeResponseId === event.responseId) {
          this.activeResponseId = null;
        }
        if (this.ttsStartedForResponse === event.responseId) {
          this.ttsStartedForResponse = null;
          // Generation outruns playback; tts-complete means "finished
          // speaking" to clients, so wait for the queue to drain. A
          // barge-in bumps the epoch and already sent tts-cancelled, so
          // skip the completion message then.
          const epochAtDone = this.playback.currentEpoch;
          void this.playback.whenDrained().then(() => {
            if (!this.stopped && this.playback.currentEpoch === epochAtDone) {
              this.callbacks.send({ type: 'tts-complete' });
            }
          });
        }
        if (event.usage) {
          this.callbacks.send({ type: 'usage', ...event.usage });
          this.metrics.increment('realtime.tokens.input', event.usage.inputTokens);
          this.metrics.increment('realtime.tokens.output', event.usage.outputTokens);
          if (event.usage.audioInputTokens) {
            this.metrics.increment('realtime.tokens.audio_in', event.usage.audioInputTokens);
          }
          if (event.usage.audioOutputTokens) {
            this.metrics.increment('realtime.tokens.audio_out', event.usage.audioOutputTokens);
          }
          if (event.usage.cachedTokens) {
            this.metrics.increment('realtime.tokens.cached', event.usage.cachedTokens);
          }
        }
        break;
      }
      case 'user-transcript':
        this.callbacks.send({ type: 'transcript', text: event.text, isFinal: event.isFinal });
        if (event.isFinal && event.text.trim()) {
          this.history.push({ role: 'user', content: event.text });
        }
        break;
      case 'assistant-transcript':
        this.callbacks.send({
          type: 'assistant-transcript',
          text: event.text,
          isFinal: event.isFinal
        });
        if (event.isFinal && event.text.trim()) {
          this.history.push({ role: 'assistant', content: event.text });
        }
        break;
      case 'user-speech-started':
        this.callbacks.send({ type: 'speech-start' });
        this.bargeIn('user-speech-started');
        break;
      case 'user-speech-stopped':
        this.speechStoppedAt = Date.now();
        this.callbacks.send({ type: 'speech-end' });
        break;
      case 'interrupted':
        this.bargeIn('interrupted');
        break;
      case 'session-expiring':
        // Renewal lands in M2; for now surface the signal to operators
        this.logger.warn(
          `[realtime-relay] provider session expiring${event.inMs ? ` in ~${Math.round(event.inMs / 1000)}s` : ''}`
        );
        this.metrics.increment('realtime.session.expiring', 1);
        break;
      case 'tool-call':
      case 'tool-call-cancelled':
        // Tool bridging lands in M2
        this.logger.warn(`[realtime-relay] ${event.type} received but tool bridging is not enabled yet`);
        break;
      case 'error':
        if (event.recoverable) {
          this.logger.warn('[realtime-relay] recoverable provider error:', event.error.message);
          this.metrics.increment('realtime.errors.recoverable', 1);
        } else {
          this.callbacks.onFatal(event.error);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Barge-in (RFC 0001 §4): only when a response is active and audio
   * has been fed - a speech-start during tool execution or racing
   * response-done triggers nothing.
   */
  private bargeIn(reason: 'user-speech-started' | 'interrupted'): void {
    const startedAt = Date.now();
    // Playback clearing and provider cancellation are independent:
    // generation runs faster than realtime, so audio is often still
    // playing long after response-done - the local clear must happen
    // whenever audio is audible, while the provider cancel only makes
    // sense while a response is still active.
    const audioAudible = this.playback.audioFedThisEpoch;
    const playedMs = this.playback.playedMsForCurrentItem;
    if (audioAudible) {
      this.playback.clear();
      this.callbacks.send({ type: 'tts-cancelled' });
      this.metrics.increment('realtime.interruptions', 1);
      this.metrics.timing('realtime.bargein_reaction', Date.now() - startedAt);
    }
    if (reason === 'user-speech-started' && this.activeResponseId !== null) {
      // Safe no-op inside the adapter if the response just completed
      this.session.cancelResponse(playedMs);
      this.activeResponseId = null;
    }
    if (!audioAudible) {
      this.metrics.increment('realtime.races', 1);
    }
    this.ttsStartedForResponse = null;
  }
}
