import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  ContentBlock,
  Message as BedrockMessage,
  SystemContentBlock,
  ImageFormat
} from '@aws-sdk/client-bedrock-runtime';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';

export interface BedrockConfig {
  /** AWS region (default: 'us-east-1') */
  region?: string;
  /** AWS credentials (optional - uses default credential provider chain if not provided) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Model ID (default: 'anthropic.claude-3-5-sonnet-20241022-v2:0') */
  model?: string;
}

/**
 * AWS Bedrock LLM Provider.
 *
 * Uses the Converse API for a unified interface across all Bedrock models
 * including Claude, Amazon Nova, Llama, Mistral, and more.
 *
 * Credentials can be provided directly or via AWS credential provider chain
 * (environment variables, shared credentials file, IAM role, etc.).
 *
 * @example
 * ```typescript
 * const provider = new BedrockLLMProvider({
 *   region: 'us-east-1',
 *   model: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
 * });
 * ```
 */
export class BedrockLLMProvider implements LLMProvider {
  readonly name = 'bedrock-llm';
  private client: BedrockRuntimeClient;
  private model: string;

  constructor(private readonly config: BedrockConfig = {}) {
    this.model = config.model ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';

    this.client = new BedrockRuntimeClient({
      region: config.region ?? 'us-east-1',
      credentials: config.credentials
    });
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const { system, messages } = convertMessages(request.messages);

    const command = new ConverseCommand({
      modelId: this.model,
      system,
      messages,
      inferenceConfig: {
        temperature: request.config?.temperature,
        topP: request.config?.topP,
        maxTokens: request.config?.maxTokens ?? 4096
      }
    });

    const response = await this.client.send(command);
    const fullText =
      response.output?.message?.content
        ?.filter((block): block is { text: string } => 'text' in block)
        .map((block) => block.text)
        .join('') ?? '';

    return { fullText, raw: response };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const { system, messages } = convertMessages(request.messages);

    const command = new ConverseStreamCommand({
      modelId: this.model,
      system,
      messages,
      inferenceConfig: {
        temperature: request.config?.temperature,
        topP: request.config?.topP,
        maxTokens: request.config?.maxTokens ?? 4096
      }
    });

    const response = await this.client.send(command);

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockDelta?.delta && 'text' in event.contentBlockDelta.delta) {
          yield {
            content: event.contentBlockDelta.delta.text ?? '',
            done: false,
            raw: event
          };
        }
      }
    }

    yield { content: '', done: true };
  }
}

/**
 * Convert our messages to Bedrock Converse API format
 */
function convertMessages(messages: Message[]): {
  system: SystemContentBlock[] | undefined;
  messages: BedrockMessage[];
} {
  let system: SystemContentBlock[] | undefined;
  const converted: BedrockMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = [{ text: msg.content }];
      continue;
    }

    const content: ContentBlock[] = [];

    // Add text content
    if (msg.content) {
      content.push({ text: msg.content });
    }

    // Add vision attachments
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        const { format, data } = parseDataUri(att.data);
        content.push({
          image: {
            format: format as ImageFormat,
            source: {
              bytes: Buffer.from(data, 'base64')
            }
          }
        });
      }
    }

    converted.push({
      role: msg.role as 'user' | 'assistant',
      content
    });
  }

  return { system, messages: converted };
}

/**
 * Parse a data URI into format and base64 data for Bedrock
 */
function parseDataUri(uri: string): {
  format: string;
  data: string;
} {
  const match = uri.match(/^data:image\/([^;]+);base64,(.+)$/);
  if (match) {
    const mimeSubtype = match[1].toLowerCase();
    const format = mimeSubtype === 'jpg' ? 'jpeg' : mimeSubtype;
    return { format, data: match[2] };
  }
  // If not a data URI, assume it's already base64 and default to jpeg
  return { format: 'jpeg', data: uri };
}
