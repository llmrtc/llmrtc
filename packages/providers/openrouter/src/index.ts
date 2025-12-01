import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';
import {
  mapToolsToOpenAI,
  mapToolChoiceToOpenAI,
  parseToolCallsFromOpenAI,
  mapStopReasonFromOpenAI,
  processToolCallDelta,
  finalizeToolCalls,
  StreamingToolCallAccumulator,
} from './tool-adapter.js';

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
      stream: false,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });
    const choice = completion.choices?.[0];
    const fullText = choice?.message?.content ?? '';
    const toolCalls = parseToolCallsFromOpenAI(choice?.message?.tool_calls);
    const stopReason = mapStopReasonFromOpenAI(choice?.finish_reason);
    return { fullText, raw: completion, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: true,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });
    const toolCallAccumulators = new Map<number, StreamingToolCallAccumulator>();
    let finishReason: string | null = null;

    for await (const part of stream) {
      const choice = part.choices?.[0];
      const delta = choice?.delta;
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          processToolCallDelta(toolCallAccumulators, toolCallDelta);
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      yield { content: delta?.content ?? '', done: false, raw: part };
    }

    const toolCalls = toolCallAccumulators.size > 0 ? finalizeToolCalls(toolCallAccumulators) : undefined;
    const stopReason = mapStopReasonFromOpenAI(finishReason);
    yield { content: '', done: true, toolCalls, stopReason };
  }
}

function mapMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      } as ChatCompletionToolMessageParam;
    }
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
