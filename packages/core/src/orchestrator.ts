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

// Sentence boundary regex: matches .!? followed by space or end of string
// Handles common abbreviations by requiring whitespace after punctuation
const SENTENCE_BOUNDARY = /[.!?]+(?:\s+|$)/;

export class ConversationOrchestrator {
  private readonly providers: ConversationProviders;
  private readonly history: Message[] = [];
  private readonly systemPrompt?: string;
  private readonly historyLimit: number;
  private readonly logger;
  private readonly streamingTTS: boolean;

  constructor(private readonly config: ConversationOrchestratorConfig) {
    this.providers = config.providers;
    this.systemPrompt = config.systemPrompt;
    this.historyLimit = config.historyLimit ?? 8;
    this.logger = config.logger ?? console;
    this.streamingTTS = config.streamingTTS ?? true;
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
   */
  async *runTurnStream(audio: Buffer, attachments: VisionAttachment[] = []): AsyncGenerator<
    OrchestratorYield,
    void,
    unknown
  > {
    const transcript = await this.providers.stt.transcribe(audio);
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

    // Non-streaming LLM fallback
    if (!this.providers.llm.stream) {
      const llm = await this.providers.llm.complete(llmRequest);
      this.pushHistory({ role: 'assistant', content: llm.fullText });
      yield llm;
      yield* this.generateTTS(llm.fullText);
      return;
    }

    // Check if we can do streaming TTS (requires config enabled AND provider support)
    const canStreamTTS = this.streamingTTS && !!this.providers.tts.speakStream;

    let assembled = '';
    let pendingText = '';
    let ttsStarted = false;

    for await (const chunk of this.providers.llm.stream(llmRequest)) {
      if (chunk.content) {
        assembled += chunk.content;
        pendingText += chunk.content;
      }
      yield chunk;

      // Only do sentence-boundary TTS if provider supports streaming
      if (canStreamTTS && pendingText) {
        // Check for complete sentences
        const match = pendingText.match(SENTENCE_BOUNDARY);
        if (match && match.index !== undefined) {
          const boundaryEnd = match.index + match[0].length;
          const completeSentence = pendingText.slice(0, boundaryEnd).trim();
          pendingText = pendingText.slice(boundaryEnd);

          if (completeSentence) {
            // Signal TTS start on first sentence
            if (!ttsStarted) {
              ttsStarted = true;
              yield { type: 'tts-start' } as TTSStart;
            }

            // Stream TTS for this sentence
            yield* this.streamTTSChunks(completeSentence);
          }
        }
      }
    }

    // Yield LLM result
    const llmResult: LLMResult = { fullText: assembled };
    this.pushHistory({ role: 'assistant', content: assembled });
    yield llmResult;

    // Handle remaining text after LLM completes
    if (canStreamTTS) {
      const remainingText = pendingText.trim();
      if (remainingText) {
        if (!ttsStarted) {
          ttsStarted = true;
          yield { type: 'tts-start' } as TTSStart;
        }
        yield* this.streamTTSChunks(remainingText);
      }
      // Signal TTS complete
      if (ttsStarted) {
        yield { type: 'tts-complete' } as TTSComplete;
      }
    } else {
      // Fallback to non-streaming TTS
      yield* this.generateTTS(assembled);
    }
  }

  /**
   * Stream TTS chunks for a sentence using PCM format.
   * Yields TTSChunk events as audio data arrives.
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
