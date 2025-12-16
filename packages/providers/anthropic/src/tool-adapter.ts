/**
 * Anthropic Tool Adapter
 *
 * Converts provider-agnostic tool definitions to Anthropic's format and
 * parses tool calls from Anthropic responses.
 */

import type { Tool, ToolChoice as AnthropicToolChoice } from '@anthropic-ai/sdk/resources/messages';
import type { ToolDefinition, ToolCallRequest, ToolChoice } from '@llmrtc/llmrtc-core';

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
        // Anthropic doesn't have 'none', so we return undefined (no tool_choice)
        return undefined;
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
    input?: Record<string, unknown>;
  }>
): ToolCallRequest[] | undefined {
  if (!content) return undefined;

  const toolUseBlocks = content.filter(block => block.type === 'tool_use');
  if (toolUseBlocks.length === 0) return undefined;

  return toolUseBlocks.map(block => ({
    callId: block.id ?? '',
    name: block.name ?? '',
    arguments: block.input ?? {},
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
 * Map stop reason from Anthropic to provider-agnostic format
 */
export function mapStopReasonFromAnthropic(
  stopReason: string | null | undefined
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
