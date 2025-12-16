import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToOpenAI,
  mapToolChoiceToOpenAI,
  parseToolCallsFromOpenAI,
  mapStopReasonFromOpenAI,
  processToolCallDelta,
  finalizeToolCalls,
  StreamingToolCallAccumulator,
} from './tool-adapter.js';

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
