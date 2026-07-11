/**
 * OpenAI Tool Adapter
 *
 * Converts provider-agnostic tool definitions to OpenAI's format and
 * parses tool calls from OpenAI responses.
 */

import type {
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type { ToolDefinition, ToolCallRequest, ToolChoice, StopReason } from '@llmrtc/llmrtc-core';

/**
 * Convert provider-agnostic tool definitions to OpenAI format
 */
export function mapToolsToOpenAI(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as FunctionParameters,
    },
  }));
}

/**
 * Convert provider-agnostic tool choice to OpenAI format
 */
export function mapToolChoiceToOpenAI(
  choice?: ToolChoice
): ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;

  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto':
        return 'auto';
      case 'none':
        return 'none';
      case 'required':
        return 'required';
      default:
        return 'auto';
    }
  }

  // Force specific tool
  return {
    type: 'function',
    function: { name: choice.name },
  };
}

/**
 * Parse tool calls from OpenAI response
 */
export function parseToolCallsFromOpenAI(
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>
): ToolCallRequest[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map(call => ({
    callId: call.id,
    name: call.function.name,
    ...parseArguments(call.function.arguments),
  }));
}

/**
 * Accumulate streaming tool call deltas
 */
export interface StreamingToolCallAccumulator {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Accumulated arguments string */
  arguments: string;
}

/**
 * Process a streaming delta and update accumulators
 */
export function processToolCallDelta(
  accumulators: Map<number, StreamingToolCallAccumulator>,
  delta: {
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }
): void {
  const { index, id, function: fn } = delta;

  if (!accumulators.has(index)) {
    accumulators.set(index, {
      id: id ?? '',
      name: fn?.name ?? '',
      arguments: '',
    });
  }

  const accumulator = accumulators.get(index)!;

  if (id) {
    accumulator.id = id;
  }
  if (fn?.name) {
    accumulator.name = fn.name;
  }
  if (fn?.arguments) {
    accumulator.arguments += fn.arguments;
  }
}

/**
 * Finalize accumulated tool calls
 */
export function finalizeToolCalls(
  accumulators: Map<number, StreamingToolCallAccumulator>
): ToolCallRequest[] {
  const calls: ToolCallRequest[] = [];

  for (const [index, acc] of Array.from(accumulators.entries()).sort(([a], [b]) => a - b)) {
    calls.push({
      // Some OpenAI-compatible backends omit ids on streamed tool calls;
      // generate one so tool results can still be correlated in history
      callId: acc.id || `call_${index}_${Date.now()}`,
      name: acc.name,
      ...parseArguments(acc.arguments),
    });
  }

  return calls;
}

/**
 * Parse the model's arguments JSON. Empty input means "no arguments";
 * unparseable input is flagged so executors can fail the call instead of
 * running the tool with silently-empty arguments.
 */
function parseArguments(str: string): {
  arguments: Record<string, unknown>;
  parseError?: string;
} {
  if (!str || !str.trim()) {
    return { arguments: {} };
  }
  try {
    return { arguments: JSON.parse(str) };
  } catch (err) {
    return {
      arguments: {},
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Map stop reason from OpenAI to provider-agnostic format
 */
export function mapStopReasonFromOpenAI(
  finishReason: string | null | undefined
): StopReason | undefined {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'content_filter';
    default:
      return undefined;
  }
}
