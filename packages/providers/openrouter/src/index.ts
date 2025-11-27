import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';

export interface OpenRouterConfig {
  /** OpenRouter API key */
  apiKey: string;
  /** Model in format 'provider/model-name' e.g. 'anthropic/claude-3.5-sonnet' */
  model: string;
  /** Base URL (default: 'https://openrouter.ai/api/v1') */
  baseURL?: string;
  /** Optional site URL for OpenRouter rankings */
  siteUrl?: string;
  /** Optional site name for OpenRouter rankings */
  siteName?: string;
}

/**
 * OpenRouter LLM Provider - Multi-model gateway using OpenAI-compatible API.
 *
 * Supports models from multiple providers (OpenAI, Anthropic, Google, Meta, etc.)
 * through a unified API. User must specify the model in 'provider/model' format.
 *
 * @example
 * ```typescript
 * const provider = new OpenRouterLLMProvider({
 *   apiKey: 'sk-or-...',
 *   model: 'anthropic/claude-3.5-sonnet'
 * });
 * ```
 */
export class OpenRouterLLMProvider implements LLMProvider {
  readonly name = 'openrouter-llm';
  private client: OpenAI;
  private model: string;
  private extraHeaders: Record<string, string>;

  constructor(private readonly config: OpenRouterConfig) {
    this.model = config.model;

    // Build extra headers for OpenRouter
    this.extraHeaders = {};
    if (config.siteUrl) {
      this.extraHeaders['HTTP-Referer'] = config.siteUrl;
    }
    if (config.siteName) {
      this.extraHeaders['X-Title'] = config.siteName;
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? 'https://openrouter.ai/api/v1',
      defaultHeaders: this.extraHeaders
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
