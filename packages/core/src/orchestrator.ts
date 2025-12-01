import {
  ConversationOrchestratorConfig,
  ConversationProviders,
  LLMChunk,
  LLMRequest,
  LLMResult,
  Message,
  OrchestratorYield,
  STTResult,
  TTSChunk,
  TTSComplete,
  TTSResult,
  TTSStart,
  VisionAttachment
} from './types.js';
import {
  OrchestratorHooks,
  TurnContext,
  createTimingInfo,
  createErrorContext,
  callHookSafe
} from './hooks.js';
import { MetricsAdapter, MetricNames, NoopMetrics } from './metrics.js';

// Sentence boundary regex: matches .!? followed by space or end of string
// Handles common abbreviations by requiring whitespace after punctuation
const SENTENCE_BOUNDARY = /[.!?]+(?:\s+|$)/;

/**
 * Extended orchestrator configuration with hooks and metrics
 */
export interface OrchestratorConfigWithHooks extends ConversationOrchestratorConfig {
  /** Hooks for observability and extensibility */
  hooks?: OrchestratorHooks;
  /** Metrics adapter for emitting timing and counter metrics */
  metrics?: MetricsAdapter;
  /** Custom sentence boundary splitter for streaming TTS */
  sentenceChunker?: (text: string) => string[];
}

export class ConversationOrchestrator {
  private readonly providers: ConversationProviders;
  private readonly history: Message[] = [];
  private readonly systemPrompt?: string;
  private readonly historyLimit: number;
  private readonly logger;
  private readonly streamingTTS: boolean;
  private readonly sessionId?: string;
  private readonly hooks: OrchestratorHooks;
  private readonly metrics: MetricsAdapter;
  private readonly sentenceChunker?: (text: string) => string[];

  constructor(private readonly config: OrchestratorConfigWithHooks) {
    this.providers = config.providers;
    this.systemPrompt = config.systemPrompt;
    this.historyLimit = config.historyLimit ?? 8;
    this.logger = config.logger ?? console;
    this.streamingTTS = config.streamingTTS ?? true;
    this.sessionId = config.sessionId;
    this.hooks = config.hooks ?? {};
    this.metrics = config.metrics ?? new NoopMetrics();
    this.sentenceChunker = config.sentenceChunker;
  }

  async init() {
    await Promise.all([
      this.providers.llm.init?.(),
      this.providers.stt.init?.(),
      this.providers.tts.init?.(),
      this.providers.vision?.init?.()
    ]);
  }

  /**
   * Run a single voice+vision turn: audio -> STT -> LLM (+optional vision) -> TTS.
   */
  async runTurn(audio: Buffer, attachments: VisionAttachment[] = []): Promise<{
    transcript: STTResult;
    llm: LLMResult;
    tts: TTSResult;
  }> {
    const transcript = await this.providers.stt.transcribe(audio);
    this.logger.debug?.('[orchestrator] transcript', transcript.text);

    const userMessage: Message = {
      role: 'user',
      content: transcript.text,
      attachments: attachments.length ? attachments : undefined
    };

    if (this.systemPrompt && !this.history.length) {
      this.history.push({ role: 'system', content: this.systemPrompt });
    }
    this.pushHistory(userMessage);

    const llmRequest: LLMRequest = {
      messages: this.history.slice(-this.historyLimit),
      config: {
        systemPrompt: this.systemPrompt,
        historyLimit: this.historyLimit,
        temperature: this.config.temperature,
        topP: this.config.topP,
        maxTokens: this.config.maxTokens
      }
    };

    const llm = await this.providers.llm.complete(llmRequest);
    this.logger.debug?.('[orchestrator] llm response', llm.fullText);

    const assistantMessage: Message = { role: 'assistant', content: llm.fullText };
    this.pushHistory(assistantMessage);

    const tts = await this.providers.tts.speak(llm.fullText);

    return { transcript, llm, tts };
  }

  /**
   * Streaming version: yields LLM chunks as they arrive.
   *
   * With streaming TTS enabled (when provider supports speakStream):
   * - Detects sentence boundaries during LLM streaming
   * - Starts TTS generation as soon as each sentence is complete
   * - Yields TTSChunk events with PCM audio data
   * - User hears audio while LLM is still generating
   *
   * Hooks and metrics are called throughout the turn lifecycle.
   */
  async *runTurnStream(audio: Buffer, attachments: VisionAttachment[] = []): AsyncGenerator<
    OrchestratorYield,
    void,
    unknown
  > {
    // Generate turn context
    const turnStartTime = Date.now();
    const ctx: TurnContext = {
      turnId: globalThis.crypto.randomUUID(),
      sessionId: this.sessionId,
      startTime: turnStartTime
    };

    // Call onTurnStart hook
    await callHookSafe(this.hooks.onTurnStart, ctx, audio);

    // -------------------------------------------------------------------------
    // STT Phase
    // -------------------------------------------------------------------------
    const sttStartTime = Date.now();
    await callHookSafe(this.hooks.onSTTStart, ctx, audio);

    let transcript: STTResult;
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

    this.pushHistory({ role: 'user', content: transcript.text, attachments: attachments.length ? attachments : undefined });
    yield transcript;

    const llmRequest: LLMRequest = {
      messages: this.history.slice(-this.historyLimit),
      config: {
        systemPrompt: this.systemPrompt,
        historyLimit: this.historyLimit,
        temperature: this.config.temperature,
        topP: this.config.topP,
        maxTokens: this.config.maxTokens
      },
      stream: true
    };

    // -------------------------------------------------------------------------
    // LLM Phase
    // -------------------------------------------------------------------------
    const llmStartTime = Date.now();
    await callHookSafe(this.hooks.onLLMStart, ctx, llmRequest);
    let llmFirstChunkTime: number | undefined;

    // Non-streaming LLM fallback
    if (!this.providers.llm.stream) {
      try {
        const llm = await this.providers.llm.complete(llmRequest);
        const llmTiming = createTimingInfo(llmStartTime, Date.now());
        this.metrics.timing(MetricNames.LLM_DURATION, llmTiming.durationMs, {
          provider: this.providers.llm.name
        });
        await callHookSafe(this.hooks.onLLMEnd, ctx, llm, llmTiming);

        this.pushHistory({ role: 'assistant', content: llm.fullText });
        yield llm;
        yield* this.generateTTSWithHooks(ctx, llm.fullText);

        // Turn complete
        const turnTiming = createTimingInfo(turnStartTime, Date.now());
        this.metrics.timing(MetricNames.TURN_DURATION, turnTiming.durationMs);
        await callHookSafe(this.hooks.onTurnEnd, ctx, turnTiming);
        return;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        await callHookSafe(this.hooks.onLLMError, ctx, err);
        this.metrics.increment(MetricNames.ERRORS, 1, { component: 'llm' });
        throw error;
      }
    }

    // Check if we can do streaming TTS (requires config enabled AND provider support)
    const canStreamTTS = this.streamingTTS && !!this.providers.tts.speakStream;

    let assembled = '';
    let pendingText = '';
    let ttsStarted = false;
    let chunkIndex = 0;
    const ttsStartTime = Date.now();

    try {
      for await (const chunk of this.providers.llm.stream(llmRequest)) {
        // Track time to first token
        if (chunkIndex === 0 && chunk.content) {
          llmFirstChunkTime = Date.now();
          this.metrics.timing(MetricNames.LLM_TTFT, llmFirstChunkTime - llmStartTime, {
            provider: this.providers.llm.name
          });
        }

        if (chunk.content) {
          assembled += chunk.content;
          pendingText += chunk.content;
        }

        // Call LLM chunk hook
        await callHookSafe(this.hooks.onLLMChunk, ctx, chunk, chunkIndex);
        chunkIndex++;
        yield chunk;

        // Only do sentence-boundary TTS if provider supports streaming
        if (canStreamTTS && pendingText) {
          // Check for complete sentences using custom chunker or default
          const sentences = this.splitIntoSentences(pendingText);
          if (sentences.length > 1) {
            // We have at least one complete sentence
            const completeSentences = sentences.slice(0, -1);
            pendingText = sentences[sentences.length - 1];

            for (const completeSentence of completeSentences) {
              if (completeSentence.trim()) {
                // Signal TTS start on first sentence
                if (!ttsStarted) {
                  ttsStarted = true;
                  await callHookSafe(this.hooks.onTTSStart, ctx, completeSentence.trim());
                  yield { type: 'tts-start' } as TTSStart;
                }

                // Stream TTS for this sentence
                yield* this.streamTTSChunksWithHooks(ctx, completeSentence.trim());
              }
            }
          }
        }
      }

      // LLM complete
      const llmEndTime = Date.now();
      const llmTiming = createTimingInfo(llmStartTime, llmEndTime);
      this.metrics.timing(MetricNames.LLM_DURATION, llmTiming.durationMs, {
        provider: this.providers.llm.name
      });

      const llmResult: LLMResult = { fullText: assembled };
      await callHookSafe(this.hooks.onLLMEnd, ctx, llmResult, llmTiming);
      this.pushHistory({ role: 'assistant', content: assembled });
      yield llmResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await callHookSafe(this.hooks.onLLMError, ctx, err);
      this.metrics.increment(MetricNames.ERRORS, 1, { component: 'llm' });
      throw error;
    }

    // -------------------------------------------------------------------------
    // TTS Phase (remaining text)
    // -------------------------------------------------------------------------
    try {
      // Handle remaining text after LLM completes
      if (canStreamTTS) {
        const remainingText = pendingText.trim();
        if (remainingText) {
          if (!ttsStarted) {
            ttsStarted = true;
            await callHookSafe(this.hooks.onTTSStart, ctx, remainingText);
            yield { type: 'tts-start' } as TTSStart;
          }
          yield* this.streamTTSChunksWithHooks(ctx, remainingText);
        }

        // Signal TTS complete
        if (ttsStarted) {
          const ttsTiming = createTimingInfo(ttsStartTime, Date.now());
          this.metrics.timing(MetricNames.TTS_DURATION, ttsTiming.durationMs, {
            provider: this.providers.tts.name
          });
          await callHookSafe(this.hooks.onTTSEnd, ctx, ttsTiming);
          yield { type: 'tts-complete' } as TTSComplete;
        }
      } else {
        // Fallback to non-streaming TTS
        yield* this.generateTTSWithHooks(ctx, assembled);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await callHookSafe(this.hooks.onTTSError, ctx, err);
      this.metrics.increment(MetricNames.ERRORS, 1, { component: 'tts' });
      throw error;
    }

    // Turn complete
    const turnTiming = createTimingInfo(turnStartTime, Date.now());
    this.metrics.timing(MetricNames.TURN_DURATION, turnTiming.durationMs);
    await callHookSafe(this.hooks.onTurnEnd, ctx, turnTiming);
  }

  /**
   * Split text into sentences using custom chunker or default regex
   */
  private splitIntoSentences(text: string): string[] {
    if (this.sentenceChunker) {
      return this.sentenceChunker(text);
    }
    // Default: split on sentence boundaries, keep last part as incomplete
    const parts = text.split(SENTENCE_BOUNDARY);
    // The split removes the delimiter, so we need to reconstruct
    const matches = text.match(new RegExp(SENTENCE_BOUNDARY.source, 'g')) || [];
    const result: string[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      result.push(parts[i] + (matches[i] || ''));
    }
    // Last part is incomplete (no boundary yet)
    if (parts.length > 0) {
      result.push(parts[parts.length - 1]);
    }
    return result;
  }

  /**
   * Stream TTS chunks for a sentence using PCM format with hooks.
   * Yields TTSChunk events as audio data arrives.
   */
  private async *streamTTSChunksWithHooks(
    ctx: TurnContext,
    text: string
  ): AsyncGenerator<TTSChunk, void, unknown> {
    if (!this.providers.tts.speakStream) return;

    let chunkIndex = 0;
    try {
      for await (const audioChunk of this.providers.tts.speakStream(text, { format: 'pcm' })) {
        const ttsChunk: TTSChunk = {
          type: 'tts-chunk',
          audio: audioChunk,
          format: 'pcm',
          sampleRate: 24000, // OpenAI/ElevenLabs PCM is 24kHz
          sentence: text
        };
        await callHookSafe(this.hooks.onTTSChunk, ctx, ttsChunk, chunkIndex);
        chunkIndex++;
        yield ttsChunk;
      }
    } catch (err) {
      this.logger.error?.('[orchestrator] TTS stream error:', err);
      // Fallback: try non-streaming TTS
      try {
        const tts = await this.providers.tts.speak(text, { format: 'pcm' });
        const ttsChunk: TTSChunk = {
          type: 'tts-chunk',
          audio: tts.audio,
          format: 'pcm',
          sampleRate: 24000,
          sentence: text
        };
        await callHookSafe(this.hooks.onTTSChunk, ctx, ttsChunk, chunkIndex);
        yield ttsChunk;
      } catch (fallbackErr) {
        this.logger.error?.('[orchestrator] TTS fallback also failed:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  /**
   * Non-streaming TTS with hooks: generates complete audio and yields as single TTSResult.
   */
  private async *generateTTSWithHooks(
    ctx: TurnContext,
    text: string
  ): AsyncGenerator<TTSStart | TTSResult | TTSComplete, void, unknown> {
    const ttsStartTime = Date.now();
    await callHookSafe(this.hooks.onTTSStart, ctx, text);
    yield { type: 'tts-start' } as TTSStart;

    const tts = await this.providers.tts.speak(text);
    yield tts;

    const ttsTiming = createTimingInfo(ttsStartTime, Date.now());
    this.metrics.timing(MetricNames.TTS_DURATION, ttsTiming.durationMs, {
      provider: this.providers.tts.name
    });
    await callHookSafe(this.hooks.onTTSEnd, ctx, ttsTiming);
    yield { type: 'tts-complete' } as TTSComplete;
  }

  /**
   * @deprecated Use streamTTSChunksWithHooks instead
   * Stream TTS chunks for a sentence using PCM format.
   */
  private async *streamTTSChunks(text: string): AsyncGenerator<TTSChunk, void, unknown> {
    if (!this.providers.tts.speakStream) return;

    try {
      for await (const audioChunk of this.providers.tts.speakStream(text, { format: 'pcm' })) {
        yield {
          type: 'tts-chunk',
          audio: audioChunk,
          format: 'pcm',
          sampleRate: 24000, // OpenAI/ElevenLabs PCM is 24kHz
          sentence: text
        };
      }
    } catch (err) {
      this.logger.error?.('[orchestrator] TTS stream error:', err);
      // Fallback: try non-streaming TTS
      try {
        const tts = await this.providers.tts.speak(text, { format: 'pcm' });
        yield {
          type: 'tts-chunk',
          audio: tts.audio,
          format: 'pcm',
          sampleRate: 24000,
          sentence: text
        };
      } catch (fallbackErr) {
        this.logger.error?.('[orchestrator] TTS fallback also failed:', fallbackErr);
      }
    }
  }

  /**
   * @deprecated Use generateTTSWithHooks instead
   * Non-streaming TTS: generates complete audio and yields as single TTSResult.
   */
  private async *generateTTS(text: string): AsyncGenerator<TTSStart | TTSResult | TTSComplete, void, unknown> {
    yield { type: 'tts-start' } as TTSStart;
    const tts = await this.providers.tts.speak(text);
    yield tts;
    yield { type: 'tts-complete' } as TTSComplete;
  }

  private pushHistory(message: Message) {
    this.history.push(message);
    if (this.history.length > this.historyLimit + 2) {
      // keep system prompt if present
      const start = this.history[0]?.role === 'system' ? 1 : 0;
      const overflow = this.history.length - (this.historyLimit + 2);
      this.history.splice(start, overflow);
    }
  }
}
