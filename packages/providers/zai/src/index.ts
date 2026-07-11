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

export interface ZaiConfig {
  /** Z.ai API key */
  apiKey: string;
  /** Model name (default: 'glm-5.2') */
  model?: string;
  /** Base URL (default: 'https://api.z.ai/api/paas/v4') */
  baseURL?: string;
}

/**
 * Z.ai GLM LLM Provider - Zhipu's GLM models via the OpenAI-compatible API.
 *
 * GLM 5.2 is an open-weight (MIT) MoE model with a 1M-token context window
 * and strong tool calling at low cost, which makes it a good fit for
 * cost-sensitive voice agents.
 *
 * GLM models are also reachable through OpenRouter
 * (`OpenRouterLLMProvider` with model 'z-ai/glm-5.2') if you prefer a
 * single gateway key.
 *
 * @example
 * ```typescript
 * const provider = new ZaiLLMProvider({
 *   apiKey: process.env.ZAI_API_KEY!,
 *   model: 'glm-5.2'
 * });
 * ```
 */
export class ZaiLLMProvider implements LLMProvider {
  readonly name = 'zai-llm';
  private client: OpenAI;
  private model: string;

  constructor(private readonly config: ZaiConfig) {
    this.model = config.model ?? 'glm-5.2';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? 'https://api.z.ai/api/paas/v4'
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

    // Assistant messages must carry their tool_calls when replayed;
    // OpenAI-compatible APIs reject tool results with no matching call
    if (m.role === 'assistant') {
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || null,
      };
      if (m.toolCalls?.length) {
        assistantMsg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.callId,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
      return assistantMsg;
    }

    if (!m.attachments?.length) {
      return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    }
    // Vision support for multimodal GLM variants - attachments map to
    // OpenAI-style image_url parts
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
