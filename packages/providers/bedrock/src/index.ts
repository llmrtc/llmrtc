import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  ContentBlock,
  Message as BedrockMessage,
  SystemContentBlock,
  ImageFormat,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToBedrock,
  mapToolChoiceToBedrock,
  parseToolCallsFromBedrock,
  mapStopReasonFromBedrock,
  processToolUseStart,
  processToolUseDelta,
  finalizeToolCalls,
  createToolResultBlock,
  StreamingToolUseAccumulator,
} from './tool-adapter.js';

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
      },
      ...(request.tools?.length && {
        toolConfig: {
          ...mapToolsToBedrock(request.tools),
          toolChoice: mapToolChoiceToBedrock(request.toolChoice),
        },
      }),
    });

    const response = await this.client.send(command);
    const content = response.output?.message?.content;
    const fullText =
      content
        ?.filter((block): block is { text: string } => 'text' in block)
        .map((block) => block.text)
        .join('') ?? '';

    const toolCalls = parseToolCallsFromBedrock(content);
    const stopReason = mapStopReasonFromBedrock(response.stopReason);

    return { fullText, raw: response, toolCalls, stopReason };
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
      },
      ...(request.tools?.length && {
        toolConfig: {
          ...mapToolsToBedrock(request.tools),
          toolChoice: mapToolChoiceToBedrock(request.toolChoice),
        },
      }),
    });

    const response = await this.client.send(command);

    // Accumulate tool use blocks across streaming events
    const toolUseAccumulators = new Map<number, StreamingToolUseAccumulator>();
    let stopReason: string | undefined;
    let currentBlockIndex = 0;

    if (response.stream) {
      for await (const event of response.stream) {
        // Handle text content deltas
        if (event.contentBlockDelta?.delta && 'text' in event.contentBlockDelta.delta) {
          yield {
            content: event.contentBlockDelta.delta.text ?? '',
            done: false,
            raw: event
          };
        }

        // Handle tool use block start
        if (event.contentBlockStart?.start && 'toolUse' in event.contentBlockStart.start) {
          const toolUse = event.contentBlockStart.start.toolUse;
          processToolUseStart(toolUseAccumulators, event.contentBlockStart.contentBlockIndex ?? currentBlockIndex, {
            toolUseId: toolUse?.toolUseId,
            name: toolUse?.name,
          });
          currentBlockIndex++;
        }

        // Handle tool use input deltas
        if (event.contentBlockDelta?.delta && 'toolUse' in event.contentBlockDelta.delta) {
          const input = event.contentBlockDelta.delta.toolUse?.input;
          if (input) {
            processToolUseDelta(
              toolUseAccumulators,
              event.contentBlockDelta.contentBlockIndex ?? currentBlockIndex - 1,
              input
            );
          }
        }

        // Track stop reason
        if (event.messageStop?.stopReason) {
          stopReason = event.messageStop.stopReason;
        }
      }
    }

    // Final chunk with accumulated tool calls
    const toolCalls = toolUseAccumulators.size > 0
      ? finalizeToolCalls(toolUseAccumulators)
      : undefined;
    const mappedStopReason = mapStopReasonFromBedrock(stopReason);

    yield { content: '', done: true, toolCalls, stopReason: mappedStopReason };
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

    // Handle tool result messages
    if (msg.role === 'tool') {
      converted.push({
        role: 'user',
        content: [{
          toolResult: createToolResultBlock(msg.toolCallId ?? '', msg.content),
        }],
      });
      continue;
    }

    // Handle assistant messages with tool calls
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const content: ContentBlock[] = [];
      if (msg.content) {
        content.push({ text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          toolUse: {
            toolUseId: tc.callId,
            name: tc.name,
            input: tc.arguments,
          },
        });
      }
      converted.push({
        role: 'assistant',
        content,
      });
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
