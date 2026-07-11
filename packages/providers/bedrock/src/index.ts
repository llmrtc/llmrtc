import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  ContentBlock,
  Message as BedrockMessage,
  SystemContentBlock,
  ImageFormat,
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
  /** Model ID (default: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0') */
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
 *   model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
 * });
 * ```
 */
/**
 * Claude families that reject temperature/top_p with a ValidationException
 * on the Converse API (same constraint as the first-party Anthropic API).
 */
const SAMPLING_UNSUPPORTED = [
  /anthropic\.claude-sonnet-5/,
  /anthropic\.claude-opus-4-7/,
  /anthropic\.claude-opus-4-8/,
  /anthropic\.claude-fable/,
  /anthropic\.claude-mythos/,
];

export class BedrockLLMProvider implements LLMProvider {
  readonly name = 'bedrock-llm';
  private client: BedrockRuntimeClient;
  private model: string;
  private warnedSamplingDropped = false;

  /**
   * Sampling params for the request, or empty when the target model rejects
   * them (Claude Sonnet 5 / Opus 4.7+ / Fable-tier on Bedrock).
   */
  private samplingParams(request: LLMRequest): { temperature?: number; topP?: number } {
    const supported = !SAMPLING_UNSUPPORTED.some((re) => re.test(this.model.toLowerCase()));
    if (supported) {
      return {
        temperature: request.config?.temperature,
        topP: request.config?.topP,
      };
    }
    if (
      !this.warnedSamplingDropped &&
      (request.config?.temperature !== undefined || request.config?.topP !== undefined)
    ) {
      this.warnedSamplingDropped = true;
      console.warn(
        `[bedrock-llm] ${this.model} does not accept temperature/top_p; ` +
          'the configured sampling parameters are ignored for this model.'
      );
    }
    return {};
  }

  constructor(private readonly config: BedrockConfig = {}) {
    // The cross-region inference profile id: bare model ids cannot be
    // invoked on-demand for current Claude generations.
    this.model = config.model ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

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
        ...this.samplingParams(request),
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
        ...this.samplingParams(request),
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
  const systemParts: string[] = [];
  const converted: BedrockMessage[] = [];

  // The Converse API enforces strict user/assistant alternation, so
  // consecutive same-role messages (e.g. one user message per parallel tool
  // result) must be merged into a single message.
  const pushMerged = (message: BedrockMessage) => {
    const last = converted[converted.length - 1];
    if (last && last.role === message.role) {
      last.content = [...(last.content ?? []), ...(message.content ?? [])];
    } else {
      converted.push(message);
    }
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Preserve every system message rather than keeping only the last
      systemParts.push(msg.content);
      continue;
    }

    // Handle tool result messages
    if (msg.role === 'tool') {
      pushMerged({
        role: 'user',
        content: [{
          toolResult: createToolResultBlock(msg.toolCallId ?? '', msg.content),
        } as ContentBlock],
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
            // Cast to match SDK type expectations (actual API accepts Record<string, unknown>)
            input: tc.arguments as ContentBlock['toolUse'] extends { input?: infer T } ? T : never,
          },
        });
      }
      pushMerged({
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

    // Converse rejects messages with no content blocks
    if (content.length === 0) {
      continue;
    }

    pushMerged({
      role: msg.role as 'user' | 'assistant',
      content
    });
  }

  return {
    system: systemParts.length ? [{ text: systemParts.join('\n\n') }] : undefined,
    messages: converted
  };
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
