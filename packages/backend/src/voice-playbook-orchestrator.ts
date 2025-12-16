/**
 * VoicePlaybookOrchestrator
 *
 * Hybrid orchestrator that combines voice processing with playbook tool calling.
 * Implements two-phase execution for voice sessions:
 * - Phase 1 (tool loop): Silent - tools run in background, emit events to client
 * - Phase 2 (final answer): Streaming LLM → sentence chunking → TTS streaming
 */

import {
  PlaybookOrchestrator,
  PlaybookOrchestratorOptions,
  type Playbook,
  ToolRegistry,
  type ConversationProviders,
  type LLMRequest,
  type LLMResult,
  type LLMChunk,
  type VisionAttachment,
  type OrchestratorHooks,
  type TTSChunk,
  type TTSStart,
  type TTSComplete,
  type TTSResult,
  type TurnContext,
  type MetricsAdapter,
  MetricNames,
  NoopMetrics,
  createTimingInfo,
  callHookSafe
} from '@llmrtc/llmrtc-core';
import type {
  TurnOrchestrator,
  TurnOrchestratorYield,
  TurnOptions,
  ToolCallStartEvent,
  ToolCallEndEvent,
  StageChangeEvent
} from './turn-orchestrator.js';

// Re-export types for convenience
export type { ToolCallStartEvent, ToolCallEndEvent, StageChangeEvent, TurnOrchestratorYield, TurnOptions };

// Sentence boundary regex: matches .!? followed by space or end of string
const SENTENCE_BOUNDARY = /[.!?]+(?:\s+|$)/;

/**
 * @deprecated Use TurnOrchestratorYield instead
 */
export type VoicePlaybookYield = TurnOrchestratorYield;

/**
 * Configuration for VoicePlaybookOrchestrator
 */
export interface VoicePlaybookConfig {
  /** Providers for LLM, STT, TTS */
  providers: ConversationProviders;
  /** Playbook definition */
  playbook: Playbook;
  /** Tool registry with registered tools */
  toolRegistry: ToolRegistry;
  /** System prompt (merged with playbook stage prompts) */
  systemPrompt?: string;
  /** Enable streaming TTS (default: true) */
  streamingTTS?: boolean;
  /** Hooks for observability */
  hooks?: OrchestratorHooks;
  /** Metrics adapter */
  metrics?: MetricsAdapter;
  /** Session ID for context */
  sessionId?: string;
  /** Custom sentence boundary splitter */
  sentenceChunker?: (text: string) => string[];
  /** Playbook orchestrator options */
  playbookOptions?: PlaybookOrchestratorOptions;
}

/**
 * VoicePlaybookOrchestrator - Voice + Playbook Integration
 *
 * Combines STT, PlaybookOrchestrator (tools), and TTS for voice sessions.
 * Phase 1: Silent tool execution with UI events
 * Phase 2: Streaming final response with TTS
 */
export class VoicePlaybookOrchestrator implements TurnOrchestrator {
  private readonly providers: ConversationProviders;
  private readonly playbookOrchestrator: PlaybookOrchestrator;
  private readonly systemPrompt?: string;
  private readonly streamingTTS: boolean;
  private readonly hooks: OrchestratorHooks;
  private readonly metrics: MetricsAdapter;
  private readonly sessionId?: string;
  private readonly sentenceChunker?: (text: string) => string[];

  constructor(config: VoicePlaybookConfig) {
    this.providers = config.providers;
    this.systemPrompt = config.systemPrompt;
    this.streamingTTS = config.streamingTTS ?? true;
    this.hooks = config.hooks ?? {};
    this.metrics = config.metrics ?? new NoopMetrics();
    this.sessionId = config.sessionId;
    this.sentenceChunker = config.sentenceChunker;

    // Create PlaybookOrchestrator for tool/stage management
    this.playbookOrchestrator = new PlaybookOrchestrator(
      config.providers.llm,
      config.playbook,
      config.toolRegistry,
      {
        debug: config.playbookOptions?.debug,
        logger: config.playbookOptions?.logger,
        maxToolCallsPerTurn: config.playbookOptions?.maxToolCallsPerTurn ?? 10,
        phase1TimeoutMs: config.playbookOptions?.phase1TimeoutMs ?? 60000,
        abortSignal: config.playbookOptions?.abortSignal
      }
    );
  }

  /**
   * Initialize providers
   */
  async init(): Promise<void> {
    await Promise.all([
      this.providers.llm.init?.(),
      this.providers.stt.init?.(),
      this.providers.tts.init?.(),
      this.providers.vision?.init?.()
    ]);
  }

  /**
   * Get the underlying PlaybookOrchestrator for state access
   */
  getPlaybookOrchestrator(): PlaybookOrchestrator {
    return this.playbookOrchestrator;
  }

  /**
   * Run a voice turn with playbook support:
   * 1. STT: audio → transcript
   * 2. Phase 1: Tool loop (silent, emit events)
   * 3. Phase 2: Streaming LLM → TTS
   * @param audio - Audio buffer to transcribe
   * @param attachments - Optional vision attachments
   * @param options - Optional turn options including abort signal
   */
  async *runTurnStream(
    audio: Buffer,
    attachments: VisionAttachment[] = [],
    options?: TurnOptions
  ): AsyncGenerator<VoicePlaybookYield, void, unknown> {
    const signal = options?.signal;
    const turnStartTime = Date.now();
    const ctx: TurnContext = {
      turnId: globalThis.crypto.randomUUID(),
      sessionId: this.sessionId,
      startTime: turnStartTime
    };

    // Call onTurnStart hook
    await callHookSafe(this.hooks.onTurnStart, ctx, audio);

    // Check for abort before starting
    if (signal?.aborted) {
      return;
    }

    // =========================================================================
    // STT Phase
    // =========================================================================
    const sttStartTime = Date.now();
    await callHookSafe(this.hooks.onSTTStart, ctx, audio);

    let transcript: { text: string; isFinal: boolean };
    try {
      transcript = await this.providers.stt.transcribe(audio);
      const sttTiming = createTimingInfo(sttStartTime, Date.now());
      this.metrics.timing(MetricNames.STT_DURATION, sttTiming.durationMs, {
        provider: this.providers.stt.name
      });
      await callHookSafe(this.hooks.onSTTEnd, ctx, transcript, sttTiming);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await callHookSafe(this.hooks.onSTTError, ctx, err);
      this.metrics.increment(MetricNames.ERRORS, 1, { component: 'stt' });
      throw error;
    }

    // Yield transcript to client
    yield transcript;

    // Guard against empty transcripts
    if (!transcript.text.trim()) {
      console.warn('[voice-playbook-orchestrator] Empty STT transcript received, skipping LLM call');
      const turnTiming = createTimingInfo(turnStartTime, Date.now());
      this.metrics.timing(MetricNames.TURN_DURATION, turnTiming.durationMs);
      await callHookSafe(this.hooks.onTurnEnd, ctx, turnTiming);
      yield { type: 'tts-complete' } as TTSComplete;
      return;
    }

    // =========================================================================
    // Phase 1: Tool Loop (Silent)
    // =========================================================================
    // Subscribe to playbook events and forward them
    const toolCallEvents: VoicePlaybookYield[] = [];
    let previousStage = this.playbookOrchestrator.getEngine().getCurrentStage().id;

    const unsubscribe = this.playbookOrchestrator.on(async (event) => {
      if (event.type === 'tool_call_start') {
        const toolEvent: ToolCallStartEvent = {
          type: 'tool-call-start',
          name: event.call.name,
          callId: event.call.callId,
          arguments: event.call.arguments as Record<string, unknown>
        };
        toolCallEvents.push(toolEvent);
      } else if (event.type === 'tool_call_complete') {
        const toolEvent: ToolCallEndEvent = {
          type: 'tool-call-end',
          callId: event.call.callId,
          result: event.result.result,
          error: event.result.error,
          durationMs: event.result.durationMs
        };
        toolCallEvents.push(toolEvent);
      } else if (event.type === 'stage_enter') {
        const stageEvent: StageChangeEvent = {
          type: 'stage-change',
          from: previousStage,
          to: event.stage.id,
          reason: 'Playbook transition'
        };
        previousStage = event.stage.id;
        toolCallEvents.push(stageEvent);
      }
    });

    try {
      // Run PlaybookOrchestrator's streamTurn for Phase 1
      // Collect tool calls and final response
      let phase1Response = '';
      const llmStartTime = Date.now();
      await callHookSafe(this.hooks.onLLMStart, ctx, { messages: [] } as LLMRequest);

      for await (const item of this.playbookOrchestrator.streamTurn(transcript.text, attachments)) {
        // Check for abort
        if (signal?.aborted) {
          break;
        }

        // Yield all accumulated tool events
        while (toolCallEvents.length > 0) {
          yield toolCallEvents.shift()!;
        }

        if (item.type === 'tool_call') {
          // Already handled via event listener
        } else if (item.type === 'content') {
          // Stream LLM content chunks to client
          const contentData = item.data as string;
          phase1Response += contentData;
          const llmChunk: LLMChunk = {
            content: contentData,
            done: false
          };
          yield llmChunk;
        } else if (item.type === 'done') {
          // Yield final LLM chunk with done=true
          const finalChunk: LLMChunk = {
            content: '',
            done: true
          };
          yield finalChunk;
        }
      }

      // Yield any remaining tool events
      while (toolCallEvents.length > 0) {
        yield toolCallEvents.shift()!;
      }

      // =========================================================================
      // Phase 2: Final Response with Streaming TTS
      // =========================================================================
      // The PlaybookOrchestrator's streamTurn already handles the streaming
      // We need to do TTS streaming on the final response

      const llmTiming = createTimingInfo(llmStartTime, Date.now());
      this.metrics.timing(MetricNames.LLM_DURATION, llmTiming.durationMs, {
        provider: this.providers.llm.name
      });

      const llmResult: LLMResult = { fullText: phase1Response };
      await callHookSafe(this.hooks.onLLMEnd, ctx, llmResult, llmTiming);
      yield llmResult;

      // =========================================================================
      // TTS Phase
      // =========================================================================
      if (phase1Response.trim() && !signal?.aborted) {
        yield* this.generateTTSStream(ctx, phase1Response, signal);
      }

      // Turn complete
      const turnTiming = createTimingInfo(turnStartTime, Date.now());
      this.metrics.timing(MetricNames.TURN_DURATION, turnTiming.durationMs);
      await callHookSafe(this.hooks.onTurnEnd, ctx, turnTiming);

    } finally {
      unsubscribe();
    }
  }

  /**
   * Stream TTS with sentence-boundary chunking
   * @param ctx - Turn context
   * @param text - Text to speak
   * @param signal - Optional abort signal
   */
  private async *generateTTSStream(
    ctx: TurnContext,
    text: string,
    signal?: AbortSignal
  ): AsyncGenerator<TTSStart | TTSChunk | TTSComplete | TTSResult, void, unknown> {
    const ttsStartTime = Date.now();
    const canStreamTTS = this.streamingTTS && !!this.providers.tts.speakStream;

    await callHookSafe(this.hooks.onTTSStart, ctx, text);
    yield { type: 'tts-start' } as TTSStart;

    if (canStreamTTS) {
      // Streaming TTS with sentence boundaries
      const sentences = this.splitIntoSentences(text);

      let chunkIndex = 0;
      for (const sentence of sentences) {
        // Check for abort before each sentence
        if (signal?.aborted) {
          break;
        }

        const trimmed = sentence.trim();
        if (!trimmed) continue;

        try {
          for await (const audioChunk of this.providers.tts.speakStream!(trimmed, { format: 'pcm' })) {
            // Check for abort during streaming
            if (signal?.aborted) {
              break;
            }

            const ttsChunk: TTSChunk = {
              type: 'tts-chunk',
              audio: audioChunk,
              format: 'pcm',
              sampleRate: 24000,
              sentence: trimmed
            };
            await callHookSafe(this.hooks.onTTSChunk, ctx, ttsChunk, chunkIndex);
            chunkIndex++;
            yield ttsChunk;
          }
        } catch (err) {
          console.error('[voice-playbook-orchestrator] TTS stream error:', err);
          // Fallback to non-streaming TTS for this sentence
          try {
            const tts = await this.providers.tts.speak(trimmed, { format: 'pcm' });
            const ttsChunk: TTSChunk = {
              type: 'tts-chunk',
              audio: tts.audio,
              format: 'pcm',
              sampleRate: 24000,
              sentence: trimmed
            };
            await callHookSafe(this.hooks.onTTSChunk, ctx, ttsChunk, chunkIndex);
            chunkIndex++;
            yield ttsChunk;
          } catch (fallbackErr) {
            console.error('[voice-playbook-orchestrator] TTS fallback failed:', fallbackErr);
          }
        }
      }
    } else {
      // Non-streaming TTS - generate complete audio
      const tts = await this.providers.tts.speak(text);
      yield tts;
    }

    const ttsTiming = createTimingInfo(ttsStartTime, Date.now());
    this.metrics.timing(MetricNames.TTS_DURATION, ttsTiming.durationMs, {
      provider: this.providers.tts.name
    });
    await callHookSafe(this.hooks.onTTSEnd, ctx, ttsTiming);
    yield { type: 'tts-complete' } as TTSComplete;
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    if (this.sentenceChunker) {
      return this.sentenceChunker(text);
    }

    // Default sentence splitting
    const parts = text.split(SENTENCE_BOUNDARY);
    const matches = text.match(new RegExp(SENTENCE_BOUNDARY.source, 'g')) || [];
    const result: string[] = [];

    for (let i = 0; i < parts.length - 1; i++) {
      result.push(parts[i] + (matches[i] || ''));
    }

    // Last part
    if (parts.length > 0 && parts[parts.length - 1]) {
      result.push(parts[parts.length - 1]);
    }

    return result.filter(s => s.trim());
  }
}
