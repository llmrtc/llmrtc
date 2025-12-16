import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToAnthropic,
  mapToolChoiceToAnthropic,
  parseToolCallsFromAnthropic,
  mapStopReasonFromAnthropic,
  processToolUseStart,
  processToolUseDelta,
  finalizeToolCalls,
  StreamingToolUseAccumulator,
} from './tool-adapter.js';

export interface AnthropicConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model name (default: 'claude-sonnet-4-5-20250929') */
  model?: string;
  /** Max tokens for response (default: 4096) */
  maxTokens?: number;
}

/**
 * Anthropic Claude LLM Provider.
 *
 * Supports Claude 3.5 Sonnet, Claude 3 Opus, and other Anthropic models.
 * Features streaming support and vision capabilities.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicLLMProvider({
 *   apiKey: 'sk-ant-...',
 *   model: 'claude-sonnet-4-5-20250929'
 * });
 * ```
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = 'anthropic-llm';
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(private readonly config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? 'claude-sonnet-4-5-20250929';
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const { systemPrompt, messages } = extractSystemAndMessages(request.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.config?.maxTokens ?? this.maxTokens,
      system: systemPrompt,
      messages: messages,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      ...(request.tools?.length && {
        tools: mapToolsToAnthropic(request.tools),
        tool_choice: mapToolChoiceToAnthropic(request.toolChoice),
      }),
    });

    const fullText = (response.content ?? [])
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    const toolCalls = parseToolCallsFromAnthropic(response.content);
    const stopReason = mapStopReasonFromAnthropic(response.stop_reason);

    return { fullText, raw: response, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const { systemPrompt, messages } = extractSystemAndMessages(request.messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.config?.maxTokens ?? this.maxTokens,
      system: systemPrompt,
      messages: messages,
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      ...(request.tools?.length && {
        tools: mapToolsToAnthropic(request.tools),
        tool_choice: mapToolChoiceToAnthropic(request.toolChoice),
      }),
    });

    // Accumulate tool use blocks across streaming events
    const toolUseAccumulators = new Map<number, StreamingToolUseAccumulator>();
    let stopReason: string | null = null;

    for await (const event of stream) {
      // Handle text content deltas
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { content: event.delta.text, done: false, raw: event };
      }

      // Handle tool use block start
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        processToolUseStart(toolUseAccumulators, event.index, event.content_block);
      }

      // Handle tool use input deltas
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'input_json_delta'
      ) {
        processToolUseDelta(toolUseAccumulators, event.index, event.delta.partial_json);
      }

      // Track stop reason from message_delta event
      if (event.type === 'message_delta' && event.delta.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    }

    // Final chunk with accumulated tool calls
    const toolCalls = toolUseAccumulators.size > 0
      ? finalizeToolCalls(toolUseAccumulators)
      : undefined;
    const mappedStopReason = mapStopReasonFromAnthropic(stopReason);

    yield { content: '', done: true, toolCalls, stopReason: mappedStopReason };
  }
}

/**
 * Extract system prompt from messages (Anthropic requires it separately)
 */
function extractSystemAndMessages(messages: Message[]): {
  systemPrompt: string | undefined;
  messages: MessageParam[];
} {
  let systemPrompt: string | undefined;
  const converted: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
      continue;
    }

    // Handle tool result messages
    if (msg.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? '',
          content: msg.content,
        } as ToolResultBlockParam],
      });
      continue;
    }

    // Handle assistant messages with tool calls
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: ContentBlockParam[] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content } as TextBlockParam);
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: 'tool_use',
          id: tc.callId,
          name: tc.name,
          input: tc.arguments,
        } as ToolUseBlockParam);
      }
      converted.push({
        role: 'assistant',
        content,
      });
      continue;
    }

    if (!msg.attachments?.length) {
      converted.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      });
    } else {
      // Vision support - convert attachments to Anthropic format
      const content: ContentBlockParam[] = [
        { type: 'text', text: msg.content } as TextBlockParam
      ];

      for (const att of msg.attachments) {
        // Anthropic expects base64 data without the data URI prefix
        const { mediaType, data } = parseDataUri(att.data);
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: data
          }
        } as ImageBlockParam);
      }

      converted.push({
        role: msg.role as 'user' | 'assistant',
        content
      });
    }
  }

  return { systemPrompt, messages: converted };
}

/**
 * Parse a data URI into media type and base64 data
 */
function parseDataUri(uri: string): { mediaType: string; data: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mediaType: match[1], data: match[2] };
  }
  // If not a data URI, assume it's already base64 and default to jpeg
  return { mediaType: 'image/jpeg', data: uri };
}
