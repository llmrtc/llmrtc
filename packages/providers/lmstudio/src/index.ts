import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';

export interface LMStudioConfig {
  /** Base URL for LMStudio server (default: 'http://localhost:1234/v1') */
  baseUrl?: string;
  /** Model name as shown in LMStudio UI (default: 'local-model') */
  model?: string;
}

/**
 * LMStudio LLM Provider - Local model inference using OpenAI-compatible API.
 *
 * LMStudio runs on localhost and exposes an OpenAI-compatible API.
 * No API key is required for local inference.
 *
 * @example
 * ```typescript
 * const provider = new LMStudioLLMProvider({
 *   baseUrl: 'http://localhost:1234/v1',
 *   model: 'llama-3.2-3b'
 * });
 * ```
 */
export class LMStudioLLMProvider implements LLMProvider {
  readonly name = 'lmstudio-llm';
  private client: OpenAI;
  private model: string;

  constructor(private readonly config: LMStudioConfig = {}) {
    this.model = config.model ?? 'local-model';

    // LMStudio doesn't require an API key
    this.client = new OpenAI({
      apiKey: 'lm-studio', // Placeholder - LMStudio ignores this
      baseURL: config.baseUrl ?? 'http://localhost:1234/v1'
    });
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

function mapMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (!m.attachments?.length) {
      return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    }
    // Vision support - map attachments to image_url parts
    // Note: Not all local models support vision
    const imageParts = m.attachments.map((att) => ({
      type: 'image_url' as const,
      image_url: { url: att.data }
    }));
    return {
      role: m.role,
      content: [{ type: 'text' as const, text: m.content }, ...imageParts]
    } as ChatCompletionMessageParam;
  });
}
