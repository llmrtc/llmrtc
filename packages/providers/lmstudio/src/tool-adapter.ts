/**
 * LMStudio Tool Adapter - OpenAI-compatible API
 */

import type { ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import type { FunctionParameters } from 'openai/resources/shared';
import type { ToolDefinition, ToolCallRequest, ToolChoice } from '@metered/llmrtc-core';

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

export function mapToolChoiceToOpenAI(choice?: ToolChoice): ChatCompletionToolChoiceOption | undefined {
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
    arguments: safeParseJSON(call.function.arguments),
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
    .map(([_, acc]) => ({ callId: acc.id, name: acc.name, arguments: safeParseJSON(acc.arguments) }));
}

function safeParseJSON(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
}

export function mapStopReasonFromOpenAI(
  finishReason: string | null | undefined
): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | undefined {
  switch (finishReason) {
    case 'stop': return 'end_turn';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    default: return undefined;
  }
}
