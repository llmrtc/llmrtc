/**
 * Ollama Tool Adapter
 *
 * Ollama supports tool calling with a format similar to OpenAI.
 */

import type { ToolDefinition, ToolCallRequest, ToolChoice } from '@llmrtc/llmrtc-core';

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
    arguments: typeof call.function.arguments === 'string'
      ? safeParseJSON(call.function.arguments)
      : (call.function.arguments as Record<string, unknown>) ?? {},
  }));
}

function safeParseJSON(str: string): Record<string, unknown> {
  try { return JSON.parse(str); } catch { return {}; }
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
