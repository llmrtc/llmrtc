/**
 * Anthropic Tool Adapter
 *
 * Converts provider-agnostic tool definitions to Anthropic's format and
 * parses tool calls from Anthropic responses.
 */

import type { Tool, ToolChoice as AnthropicToolChoice } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDefinition, ToolCallRequest, ToolChoice, StopReason } from '@llmrtc/llmrtc-core';

/**
 * Convert provider-agnostic tool definitions to Anthropic format
 */
export function mapToolsToAnthropic(tools: ToolDefinition[]): Tool[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Tool['input_schema'],
  }));
}

/**
 * Convert provider-agnostic tool choice to Anthropic format
 */
export function mapToolChoiceToAnthropic(
  choice?: ToolChoice
): AnthropicToolChoice | undefined {
  if (!choice) return undefined;

  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto':
        return { type: 'auto' };
      case 'none':
        return { type: 'none' };
      case 'required':
        return { type: 'any' };
      default:
        return { type: 'auto' };
    }
  }

  // Force specific tool
  return {
    type: 'tool',
    name: choice.name,
  };
}

/**
 * Parse tool calls from Anthropic response content
 */
export function parseToolCallsFromAnthropic(
  content?: Array<{
    type: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>
): ToolCallRequest[] | undefined {
  if (!content) return undefined;

  const toolUseBlocks = content.filter(block => block.type === 'tool_use');
  if (toolUseBlocks.length === 0) return undefined;

  return toolUseBlocks.map(block => ({
    callId: block.id ?? '',
    name: block.name ?? '',
    arguments: (block.input as Record<string, unknown>) ?? {},
  }));
}

/**
 * Streaming tool use accumulator for Anthropic
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
  block: { id?: string; name?: string }
): void {
  accumulators.set(index, {
    id: block.id ?? '',
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
      ...parseArguments(acc.inputJson),
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
 * Map stop reason from Anthropic to provider-agnostic format
 */
export function mapStopReasonFromAnthropic(
  stopReason: string | null | undefined
): StopReason | undefined {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'refusal';
    case 'pause_turn':
      return 'pause_turn';
    case 'model_context_window_exceeded':
      return 'context_overflow';
    default:
      return undefined;
  }
}
