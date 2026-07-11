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
  PlaybookEngine,
  RealtimeSpeechConfig,
  RealtimeSpeechEvent,
  RealtimeSpeechProvider,
  RealtimeSpeechSession,
  ServerMessage,
  ToolExecutor,
  ToolRegistry,
  createErrorMessage
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
  /** Tool bridging (M2): provider tool-calls run through this registry. */
  toolRegistry?: ToolRegistry;
  /** Session renewal (M2): used to reconnect when the provider session expires. */
  provider?: RealtimeSpeechProvider;
  /** The config the session was connected with (renewal reuses it). */
  sessionConfig?: RealtimeSpeechConfig;
  /** Spend guardrails (RFC 0001 §7). maxSessionMs defaults to 120 minutes. */
  budget?: { maxSessionMs?: number; maxTokens?: number; onExceeded?: 'warn' | 'end-session' };
  /**
   * Playbook mode (RFC 0001 §5): stage transitions reconfigure the live
   * session. The engine is shared with the server so the session was
   * connected with the initial stage's instructions/tools.
   */
  playbookEngine?: PlaybookEngine;
}

export class RealtimeRelayOrchestrator {
  /** Mirrored conversation history (final transcripts), RFC 0001 §3. */
  readonly history: Message[] = [];

  private session: RealtimeSpeechSession;
  private readonly toolExecutor?: ToolExecutor;
  private readonly provider?: RealtimeSpeechProvider;
  private readonly sessionConfig?: RealtimeSpeechConfig;
  private readonly budget: { maxSessionMs: number; maxTokens?: number; onExceeded: 'warn' | 'end-session' };
  private totalTokens = 0;
  private budgetTripped = false;
  private readonly budgetWarned = new Set<string>();
  private budgetTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingTools = new Map<string, AbortController>();
  private renewing = false;
  private readonly playbookEngine?: PlaybookEngine;
  private transitionChain: Promise<void> = Promise.resolve();
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
    this.toolExecutor = options.toolRegistry ? new ToolExecutor(options.toolRegistry) : undefined;
    this.provider = options.provider;
    this.sessionConfig = options.sessionConfig;
    this.playbookEngine = options.playbookEngine;
    this.budget = {
      maxSessionMs: options.budget?.maxSessionMs ?? 120 * 60 * 1000,
      maxTokens: options.budget?.maxTokens,
      onExceeded: options.budget?.onExceeded ?? 'end-session'
    };
    if (this.budget.maxSessionMs > 0) {
      this.budgetTimer = setTimeout(() => this.tripBudget('session duration'), this.budget.maxSessionMs);
      this.budgetTimer.unref?.();
    }
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
    if (this.budgetTimer) clearTimeout(this.budgetTimer);
    for (const controller of this.pendingTools.values()) controller.abort();
    this.pendingTools.clear();
    await this.playback.stop();
    await this.session.close();
    await this.loopPromise.catch(() => {});
  }

  private async run(): Promise<void> {
    // Bound to the session this loop was started for: a renewal swap
    // must not let the OLD stream's death take down the NEW session
    const session = this.session;
    try {
      for await (const event of session.events()) {
        if (this.stopped) break;
        this.handleEvent(event);
      }
    } catch (error) {
      if (this.stopped) return;
      const err = error instanceof Error ? error : new Error(String(error));
      if (session === this.session && !this.renewing) {
        this.logger.error('[realtime-relay] provider stream failed:', err.message);
        this.callbacks.onFatal(err);
      } else {
        // Superseded stream died (e.g. mid-renewal): clear turn state so
        // the quiescence wait can complete instead of polling a dead flag
        this.logger.warn('[realtime-relay] superseded provider stream ended:', err.message);
        this.activeResponseId = null;
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
          this.totalTokens += event.usage.inputTokens + event.usage.outputTokens;
          if (this.budget.maxTokens && this.totalTokens > this.budget.maxTokens && !this.budgetTripped) {
            this.tripBudget('token budget');
          }
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
        this.metrics.increment('realtime.session.expiring', 1);
        // Only renew when the adapter has no internal recovery (RFC 0001
        // §8: OpenAI reseeds; Gemini resumes inside its adapter)
        if (event.renewable && this.provider && this.sessionConfig) {
          this.logger.warn('[realtime-relay] provider session expiring; renewing from mirrored transcripts');
          void this.renewSession();
        } else if (event.renewable) {
          this.logger.warn(
            `[realtime-relay] provider session expiring${event.inMs ? ` in ~${Math.round(event.inMs / 1000)}s` : ''} and no renewal provider configured`
          );
        }
        break;
      case 'tool-call': {
        if (event.name === 'playbook_transition' && this.playbookEngine) {
          // Serialized: parallel transition calls in one response must
          // not race the engine or interleave session.update calls
          this.transitionChain = this.transitionChain.then(() =>
            this.handleStageTransition(event.callId, event.arguments)
          );
          break;
        }
        if (!this.toolExecutor) {
          this.logger.warn(`[realtime-relay] tool-call '${event.name}' received but no toolRegistry configured`);
          this.session.sendToolResult(event.callId, { error: 'Tool execution is not configured' });
          break;
        }
        this.callbacks.send({
          type: 'tool-call-start',
          name: event.name,
          callId: event.callId,
          arguments: event.arguments
        });
        const controller = new AbortController();
        this.pendingTools.set(event.callId, controller);
        // The call belongs to THIS session; after a renewal swap its
        // call_id means nothing to the fresh session
        const boundSession = this.session;
        // Never block the control loop on tool execution
        void this.toolExecutor
          .executeSingle(
            { name: event.name, callId: event.callId, arguments: event.arguments },
            { abortSignal: controller.signal }
          )
          .then((result) => {
            // A cancelled call already reported tool-call-end and must
            // not send a late result to the provider
            if (controller.signal.aborted) return;
            this.pendingTools.delete(event.callId);
            this.callbacks.send({
              type: 'tool-call-end',
              callId: event.callId,
              result: result.result,
              error: result.error,
              durationMs: result.durationMs
            });
            if (!this.stopped && boundSession === this.session) {
              boundSession.sendToolResult(
                event.callId,
                result.success ? result.result : { error: result.error }
              );
            }
          })
          .catch((err: unknown) => {
            // A user tool returning something unserializable (circular,
            // BigInt) must not become a process-wide unhandled rejection
            this.pendingTools.delete(event.callId);
            this.logger.error(
              `[realtime-relay] tool '${event.name}' (${event.callId}) bridge failed:`,
              err instanceof Error ? err.message : err
            );
            try {
              if (!this.stopped && boundSession === this.session) {
                boundSession.sendToolResult(event.callId, {
                  error: 'Tool result could not be delivered'
                });
              }
            } catch {
              // session gone - nothing left to notify
            }
          });
        break;
      }
      case 'tool-call-cancelled':
        for (const callId of event.callIds) {
          const controller = this.pendingTools.get(callId);
          if (controller) {
            controller.abort();
            this.pendingTools.delete(callId);
            this.callbacks.send({
              type: 'tool-call-end',
              callId,
              result: null,
              error: 'cancelled',
              durationMs: 0
            });
          }
        }
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
   * Playbook stage transition (RFC 0001 §5): validate via the engine,
   * reconfigure the live session with the new stage's instructions and
   * tools, notify the client, then nudge the model to speak the new
   * stage (providers without requestResponse rely on the next user turn).
   */
  private async handleStageTransition(callId: string, args: Record<string, unknown>): Promise<void> {
    const engine = this.playbookEngine!;
    const from = engine.getCurrentStage().id;
    const targetStage = String(args.targetStage ?? '');
    const reason = String(args.reason ?? '');
    try {
      const evalResult = await engine.evaluateExplicitTransition(
        targetStage,
        reason,
        args.data as Record<string, unknown> | undefined
      );
      if (!evalResult.shouldTransition || !evalResult.transition) {
        this.session.sendToolResult(callId, {
          success: false,
          error: `Transition to '${targetStage}' was not allowed`
        });
        return;
      }
      await engine.executeTransition(evalResult.transition, args.data as Record<string, unknown> | undefined);
      const stage = engine.getCurrentStage();
      const newConfig = {
        instructions: engine.getEffectiveSystemPrompt(),
        tools: engine.getAvailableTools()
      };
      try {
        await this.session.update(newConfig);
      } catch {
        // The engine already transitioned; a session that can't be
        // reconfigured has drifted (stale instructions AND stale tool
        // exposure) - retry once, then treat as unrecoverable
        await this.session.update(newConfig).catch((err: Error) => {
          this.callbacks.onFatal(new Error(`Stage reconfiguration failed: ${err.message}`));
          throw err;
        });
      }
      this.callbacks.send({ type: 'stage-change', from, to: stage.id, reason });
      this.metrics.increment('realtime.stage_changes', 1);
      // sendToolResult already triggers a response on OpenAI (its
      // adapter sends response.create with the result) - that response
      // IS the stage announcement; a second requestResponse would
      // collide with it
      this.session.sendToolResult(callId, { success: true, stage: stage.id });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('[realtime-relay] stage transition failed:', err.message);
      try {
        this.session.sendToolResult(callId, { success: false, error: err.message });
      } catch {
        // session gone
      }
    }
  }

  /** Budget breach (RFC 0001 §7): warn or end the session. */
  private tripBudget(what: string): void {
    if (this.stopped) return;
    if (this.budget.onExceeded === 'warn') {
      if (!this.budgetWarned.has(what)) {
        this.budgetWarned.add(what);
        this.metrics.increment('realtime.budget.exceeded', 1);
        this.logger.warn(`[realtime-relay] budget exceeded (${what}); continuing (onExceeded: 'warn')`);
      }
      return;
    }
    if (this.budgetTripped) return;
    this.budgetTripped = true;
    this.metrics.increment('realtime.budget.exceeded', 1);
    this.logger.warn(`[realtime-relay] budget exceeded (${what}); ending session`);
    this.session.cancelResponse(this.playback.playedMsForCurrentItem);
    // Mirror bargeIn: in-flight deltas of the cancelled response must
    // fail the staleness check instead of replaying into the new epoch
    this.activeResponseId = null;
    this.ttsStartedForResponse = null;
    this.playback.clear();
    this.callbacks.send({ type: 'tts-cancelled' });
    this.callbacks.send(createErrorMessage('BUDGET_EXCEEDED', `Realtime session ${what} budget exceeded`));
    // Marked as already-reported so the server's fatal handler doesn't
    // send a second, generic error for the same condition
    const err = new Error(`Budget exceeded: ${what}`);
    err.name = 'ReportedRelayError';
    this.callbacks.onFatal(err);
  }

  /**
   * OpenAI 60-minute renewal (RFC 0001 §8): open a fresh session seeded
   * from the mirrored transcripts, swap at a quiet moment, close the old.
   */
  private async renewSession(): Promise<void> {
    if (this.renewing || this.stopped || !this.provider || !this.sessionConfig) return;
    this.renewing = true;
    try {
      // Wait for quiescence: no active response, no pending tool calls
      for (
        let i = 0;
        i < 100 && !this.stopped && (this.activeResponseId || this.pendingTools.size > 0);
        i++
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (this.stopped) return;
      if (this.activeResponseId || this.pendingTools.size > 0) {
        // Forced swap: pending tool results can't be answered on the new
        // session (unknown call_ids) and a half-played response would
        // leave the client stuck in "speaking" - restore the invariants
        this.logger.warn('[realtime-relay] renewing without quiescence; aborting in-flight work');
        this.metrics.increment('realtime.session.renewal_forced', 1);
        for (const controller of this.pendingTools.values()) controller.abort();
        this.pendingTools.clear();
        if (this.playback.audioFedThisEpoch) {
          this.playback.clear();
          this.callbacks.send({ type: 'tts-cancelled' });
        }
        this.activeResponseId = null;
        this.ttsStartedForResponse = null;
      }
      // Transcript digest (RFC 0001 §8): last 40 turns, byte-capped. The
      // digest goes into the instructions field, so user speech lands in
      // the prompt verbatim - an accepted injection surface per the RFC,
      // revisited in the security pass.
      const digest = this.history
        .slice(-40)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n')
        .slice(-8000);
      // With a playbook, renew into the CURRENT stage's configuration -
      // the frozen sessionConfig holds the initial stage only
      const baseInstructions =
        this.playbookEngine?.getEffectiveSystemPrompt() ?? this.sessionConfig.instructions ?? '';
      const tools = this.playbookEngine?.getAvailableTools() ?? this.sessionConfig.tools;
      const instructions = `${baseInstructions}\n\nThe conversation so far (continue it naturally; the session was renewed):\n${digest}`;
      const fresh = await this.provider.connect({ ...this.sessionConfig, instructions, tools });
      if (this.stopped) {
        // Client left while connecting: don't leak a live billable session
        void fresh.close().catch(() => {});
        return;
      }
      const old = this.session;
      this.session = fresh;
      // The old loop ends when the old session's stream closes; start
      // consuming the fresh session
      void old.close().catch(() => {});
      this.loopPromise = this.run();
      this.metrics.increment('realtime.session.renewals', 1);
      this.logger.warn('[realtime-relay] provider session renewed from mirrored transcripts');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onFatal(new Error(`Session renewal failed: ${err.message}`));
    } finally {
      this.renewing = false;
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
