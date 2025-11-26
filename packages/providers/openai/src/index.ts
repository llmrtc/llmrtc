import OpenAI, { toFile } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message,
  STTProvider,
  STTResult
} from '@metered/llmrtc-core';

export interface OpenAILLMConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai-llm';
  private client: OpenAI;
  private model: string;

  constructor(private readonly config: OpenAILLMConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'gpt-4o-mini';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: false
    });
    const fullText = completion.choices?.[0]?.message?.content ?? '';
    return { fullText, raw: completion };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: true
    });
    for await (const part of stream) {
      const delta = part.choices?.[0]?.delta?.content ?? '';
      yield { content: delta ?? '', done: false, raw: part };
    }
    yield { content: '', done: true };
  }
}

export interface OpenAIWhisperConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  language?: string;
}

export class OpenAIWhisperProvider implements STTProvider {
  readonly name = 'openai-whisper';
  private client: OpenAI;
  private model: string;
  private language?: string;

  constructor(config: OpenAIWhisperConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'whisper-1';
    this.language = config.language;
  }

  async transcribe(audio: Buffer): Promise<STTResult> {
    // Use OpenAI SDK's toFile helper for cross-platform compatibility
    const file = await toFile(audio, 'audio.webm', { type: 'audio/webm' });
    const res = await this.client.audio.transcriptions.create({
      file: file,
      model: this.model,
      language: this.language
    });
    return { text: res.text ?? '', isFinal: true, raw: res };
  }
}

function mapMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (!m.attachments?.length) return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    const imageParts = m.attachments.map((att) => ({ type: 'image_url', image_url: { url: att.data } }));
    return { role: m.role, content: [{ type: 'text', text: m.content }, ...imageParts] } as ChatCompletionMessageParam;
  });
}
