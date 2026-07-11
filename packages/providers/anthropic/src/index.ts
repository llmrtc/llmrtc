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
  /** Model name (default: 'claude-sonnet-5') */
  model?: string;
  /** Max tokens for response (default: 4096) */
  maxTokens?: number;
  /**
   * Override the sampling-parameter heuristic. Claude Sonnet 5, Opus 4.7+,
   * and Fable-tier models reject temperature/top_p at the API level, so the
   * provider omits them automatically for those families. Set true to always
   * send configured sampling params, or false to always omit them,
   * regardless of the model id.
   */
  samplingParamsSupported?: boolean;
}

/**
 * Model families that reject sampling parameters (temperature/top_p) with a
 * 400 error: Claude Sonnet 5, Opus 4.7+, and the Fable/Mythos tier steer via
 * prompting instead.
 */
const SAMPLING_UNSUPPORTED = [
  /^claude-sonnet-5/,
  /^claude-opus-4-7/,
  /^claude-opus-4-8/,
  /^claude-fable/,
  /^claude-mythos/,
];

/**
 * Anthropic Claude LLM Provider.
 *
 * Supports Claude Sonnet 5, Opus 4.8, Haiku 4.5, and other Anthropic models.
 * Features streaming support and vision capabilities.
 *
 * @example
 * ```typescript
 * const provider = new AnthropicLLMProvider({
 *   apiKey: 'sk-ant-...',
 *   model: 'claude-sonnet-5'
 * });
 * ```
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = 'anthropic-llm';
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private warnedSamplingDropped = false;

  constructor(private readonly config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? 'claude-sonnet-5';
    this.maxTokens = config.maxTokens ?? 4096;
  }

  /**
   * Sampling params for the request, or empty when the target model rejects
   * them. Passing temperature/top_p to Sonnet 5, Opus 4.7+, or Fable-tier
   * models fails the whole request with a 400.
   */
  private samplingParams(request: LLMRequest): { temperature?: number; top_p?: number } {
    const supported =
      this.config.samplingParamsSupported ??
      !SAMPLING_UNSUPPORTED.some((re) => re.test(this.model.toLowerCase()));
    if (supported) {
      return {
        temperature: request.config?.temperature,
        top_p: request.config?.topP,
      };
    }
    if (
      !this.warnedSamplingDropped &&
      (request.config?.temperature !== undefined || request.config?.topP !== undefined)
    ) {
      this.warnedSamplingDropped = true;
      console.warn(
        `[anthropic-llm] ${this.model} does not accept temperature/top_p; ` +
          'the configured sampling parameters are ignored for this model.'
      );
    }
    return {};
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const { systemPrompt, messages } = extractSystemAndMessages(request.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.config?.maxTokens ?? this.maxTokens,
      system: systemPrompt,
      messages: messages,
      ...this.samplingParams(request),
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
      ...this.samplingParams(request),
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
  const systemParts: string[] = [];
  const converted: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Preserve every system message rather than keeping only the last
      systemParts.push(msg.content);
      continue;
    }

    // Handle tool result messages
    if (msg.role === 'tool') {
      const resultBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId ?? '',
        content: msg.content,
      } as ToolResultBlockParam;

      // Group consecutive tool results into one user message: all results
      // for a parallel tool call must arrive in the single user turn that
      // follows the assistant's tool_use message
      const last = converted[converted.length - 1];
      if (
        last &&
        last.role === 'user' &&
        Array.isArray(last.content) &&
        last.content.every(block => (block as { type?: string }).type === 'tool_result')
      ) {
        (last.content as ToolResultBlockParam[]).push(resultBlock);
      } else {
        converted.push({ role: 'user', content: [resultBlock] });
      }
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

  return {
    systemPrompt: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: converted
  };
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
