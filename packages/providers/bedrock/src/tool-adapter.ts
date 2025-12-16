/**
 * Bedrock Tool Adapter
 *
 * Converts provider-agnostic tool definitions to Bedrock Converse API format
 * and parses tool calls from Bedrock responses.
 */

import type {
  Tool as BedrockTool,
  ToolConfiguration,
  ToolChoice as BedrockToolChoice,
  ContentBlock,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type { ToolDefinition, ToolCallRequest, ToolChoice } from '@llmrtc/llmrtc-core';

/**
 * Convert provider-agnostic tool definitions to Bedrock format
 */
export function mapToolsToBedrock(tools: ToolDefinition[]): ToolConfiguration {
  return {
    tools: tools.map(tool => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          json: tool.parameters as BedrockTool['toolSpec'] extends { inputSchema?: { json?: infer T } } ? T : never,
        },
      },
    })),
  };
}

/**
 * Convert provider-agnostic tool choice to Bedrock format
 */
export function mapToolChoiceToBedrock(
  choice?: ToolChoice
): BedrockToolChoice | undefined {
  if (!choice) return undefined;

  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto':
        return { auto: {} };
      case 'none':
        return undefined;
      case 'required':
        return { any: {} };
      default:
        return { auto: {} };
    }
  }

  // Force specific tool
  return {
    tool: { name: choice.name },
  };
}

/**
 * Parse tool calls from Bedrock response content blocks
 */
export function parseToolCallsFromBedrock(
  content?: ContentBlock[]
): ToolCallRequest[] | undefined {
  if (!content) return undefined;

  const toolUseBlocks = content.filter((block): block is ContentBlock & { toolUse: NonNullable<ContentBlock['toolUse']> } =>
    block.toolUse !== undefined
  );

  if (toolUseBlocks.length === 0) return undefined;

  return toolUseBlocks.map(block => ({
    callId: block.toolUse.toolUseId ?? '',
    name: block.toolUse.name ?? '',
    arguments: (block.toolUse.input as Record<string, unknown>) ?? {},
  }));
}

/**
 * Streaming tool use accumulator for Bedrock
 */
export interface StreamingToolUseAccumulator {
  id: string;
  name: string;
  inputJson: string;
}

/**
 * Process a streaming content block start for tool use
 */
export function processToolUseStart(
  accumulators: Map<number, StreamingToolUseAccumulator>,
  index: number,
  block: { toolUseId?: string; name?: string }
): void {
  accumulators.set(index, {
    id: block.toolUseId ?? '',
    name: block.name ?? '',
    inputJson: '',
  });
}

/**
 * Process a streaming tool use input delta
 */
export function processToolUseDelta(
  accumulators: Map<number, StreamingToolUseAccumulator>,
  index: number,
  partialJson: string
): void {
  const acc = accumulators.get(index);
  if (acc) {
    acc.inputJson += partialJson;
  }
}

/**
 * Finalize accumulated tool calls
 */
export function finalizeToolCalls(
  accumulators: Map<number, StreamingToolUseAccumulator>
): ToolCallRequest[] {
  const calls: ToolCallRequest[] = [];

  for (const [_, acc] of Array.from(accumulators.entries()).sort(([a], [b]) => a - b)) {
    calls.push({
      callId: acc.id,
      name: acc.name,
      arguments: safeParseJSON(acc.inputJson),
    });
  }

  return calls;
}

/**
 * Safely parse JSON, returning empty object on failure
 */
function safeParseJSON(str: string): Record<string, unknown> {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/**
 * Map stop reason from Bedrock to provider-agnostic format
 */
export function mapStopReasonFromBedrock(
  stopReason: string | undefined
): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | undefined {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return undefined;
  }
}

/**
 * Create a tool result content block for Bedrock
 */
export function createToolResultBlock(
  toolUseId: string,
  content: string
): ToolResultContentBlock {
  return {
    toolUseId,
    content: [{ text: content }],
  };
}
