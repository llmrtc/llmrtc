/**
 * Ollama Tool Adapter
 *
 * Ollama supports tool calling with a format similar to OpenAI.
 */

import type { ToolDefinition, ToolCallRequest } from '@llmrtc/llmrtc-core';

/**
 * Convert provider-agnostic tool definitions to Ollama format
 */
export function mapToolsToOllama(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

/**
 * Parse tool calls from Ollama response
 */
export function parseToolCallsFromOllama(
  toolCalls?: Array<{ function: { name: string; arguments: unknown } }>
): ToolCallRequest[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((call, index) => ({
    callId: `ollama-call-${Date.now()}-${index}`,
    name: call.function.name,
    ...(typeof call.function.arguments === 'string'
      ? parseArguments(call.function.arguments)
      : { arguments: (call.function.arguments as Record<string, unknown>) ?? {} }),
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

/**
 * Map stop reason from Ollama to provider-agnostic format
 */
export function mapStopReasonFromOllama(
  message: { tool_calls?: unknown[] }
): 'end_turn' | 'tool_use' | undefined {
  if (message.tool_calls?.length) return 'tool_use';
  return 'end_turn';
}
