import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam
} from '@anthropic-ai/sdk/resources/messages';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';

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
      top_p: request.config?.topP
    });

    const fullText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return { fullText, raw: response };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const { systemPrompt, messages } = extractSystemAndMessages(request.messages);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: request.config?.maxTokens ?? this.maxTokens,
      system: systemPrompt,
      messages: messages,
      temperature: request.config?.temperature,
      top_p: request.config?.topP
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { content: event.delta.text, done: false, raw: event };
      }
    }

    yield { content: '', done: true };
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
