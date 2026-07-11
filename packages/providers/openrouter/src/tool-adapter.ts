/**
 * OpenRouter Tool Adapter
 *
 * OpenRouter uses OpenAI-compatible API, so we reuse the same tool format.
 */

import type { ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type { ToolDefinition, ToolCallRequest, ToolChoice, StopReason } from '@llmrtc/llmrtc-core';

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

export function mapToolChoiceToOpenAI(
  choice?: ToolChoice
): ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;
  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto': return 'auto';
      case 'none': return 'none';
      case 'required': return 'required';
      default: return 'auto';
    }
  }
  return { type: 'function', function: { name: choice.name } };
}

export function parseToolCallsFromOpenAI(
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
): ToolCallRequest[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map(call => ({
    callId: call.id,
    name: call.function.name,
    ...parseArguments(call.function.arguments),
  }));
}

export interface StreamingToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export function processToolCallDelta(
  accumulators: Map<number, StreamingToolCallAccumulator>,
  delta: { index: number; id?: string; function?: { name?: string; arguments?: string } }
): void {
  const { index, id, function: fn } = delta;
  if (!accumulators.has(index)) {
    accumulators.set(index, { id: id ?? '', name: fn?.name ?? '', arguments: '' });
  }
  const acc = accumulators.get(index)!;
  if (id) acc.id = id;
  if (fn?.name) acc.name = fn.name;
  if (fn?.arguments) acc.arguments += fn.arguments;
}

export function finalizeToolCalls(accumulators: Map<number, StreamingToolCallAccumulator>): ToolCallRequest[] {
  return Array.from(accumulators.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, acc]) => ({
      // Some OpenAI-compatible backends omit ids on streamed tool calls;
      // generate one so tool results can still be correlated in history
      callId: acc.id || `call_${index}_${Date.now()}`,
      name: acc.name,
      ...parseArguments(acc.arguments),
    }));
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


export function mapStopReasonFromOpenAI(
  finishReason: string | null | undefined
): StopReason | undefined {
  switch (finishReason) {
    case 'stop': return 'end_turn';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    case 'content_filter': return 'content_filter';
    default: return undefined;
  }
}
