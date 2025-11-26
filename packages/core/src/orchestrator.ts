import {
  ConversationOrchestratorConfig,
  ConversationProviders,
  LLMChunk,
  LLMRequest,
  LLMResult,
  Message,
  STTResult,
  TTSResult,
  VisionAttachment
} from './types.js';

export class ConversationOrchestrator {
  private readonly providers: ConversationProviders;
  private readonly history: Message[] = [];
  private readonly systemPrompt?: string;
  private readonly historyLimit: number;
  private readonly logger;

  constructor(private readonly config: ConversationOrchestratorConfig) {
    this.providers = config.providers;
    this.systemPrompt = config.systemPrompt;
    this.historyLimit = config.historyLimit ?? 8;
    this.logger = config.logger ?? console;
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

  /** Streaming version: yields LLM chunks as they arrive. */
  async *runTurnStream(audio: Buffer, attachments: VisionAttachment[] = []): AsyncGenerator<
    STTResult | LLMChunk | LLMResult | TTSResult,
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

    if (!this.providers.llm.stream) {
      const llm = await this.providers.llm.complete(llmRequest);
      this.pushHistory({ role: 'assistant', content: llm.fullText });
      yield llm;
      const tts = await this.providers.tts.speak(llm.fullText);
      yield tts;
      return;
    }

    let assembled = '';
    for await (const chunk of this.providers.llm.stream(llmRequest)) {
      if (chunk.content) assembled += chunk.content;
      yield chunk;
    }
    const llmResult: LLMResult = { fullText: assembled };
    this.pushHistory({ role: 'assistant', content: assembled });
    yield llmResult;
    const tts = await this.providers.tts.speak(assembled);
    yield tts;
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
