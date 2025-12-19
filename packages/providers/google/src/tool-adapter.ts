/**
 * Google Gemini Tool Adapter
 *
 * Converts provider-agnostic tool definitions to Google Gemini format
 * and parses tool calls from Gemini responses.
 */

import type { Tool as GeminiTool, FunctionDeclaration, Part } from '@google/genai';
import type { ToolDefinition, ToolCallRequest, ToolChoice } from '@llmrtc/llmrtc-core';

/**
 * Convert provider-agnostic tool definitions to Gemini format
 */
export function mapToolsToGemini(tools: ToolDefinition[]): GeminiTool[] {
  return [{
    functionDeclarations: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as FunctionDeclaration['parameters'],
    })),
  }];
}

/**
 * Convert provider-agnostic tool choice to Gemini format
 * Gemini uses toolConfig with mode and allowedFunctionNames
 */
export function mapToolChoiceToGemini(
  choice?: ToolChoice,
  tools?: ToolDefinition[]
): { mode?: string; allowedFunctionNames?: string[] } | undefined {
  if (!choice) return undefined;

  if (typeof choice === 'string') {
    switch (choice) {
      case 'auto':
        return { mode: 'AUTO' };
      case 'none':
        return { mode: 'NONE' };
      case 'required':
        return { mode: 'ANY' };
      default:
        return { mode: 'AUTO' };
    }
  }

  // Force specific tool
  return {
    mode: 'ANY',
    allowedFunctionNames: [choice.name],
  };
}

/**
 * Parse tool calls from Gemini response parts
 */
export function parseToolCallsFromGemini(
  parts?: Part[]
): ToolCallRequest[] | undefined {
  if (!parts) return undefined;

  const functionCalls = parts.filter(part => part.functionCall);
  if (functionCalls.length === 0) return undefined;

  return functionCalls.map((part, index) => ({
    // Gemini doesn't provide call IDs, so we generate them
    callId: `gemini-call-${Date.now()}-${index}`,
    name: part.functionCall?.name ?? '',
    arguments: (part.functionCall?.args as Record<string, unknown>) ?? {},
  }));
}

/**
 * Streaming function call accumulator for Gemini
 */
export interface StreamingFunctionCallAccumulator {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Process streaming function call
 */
export function processStreamingFunctionCall(
  accumulators: Map<number, StreamingFunctionCallAccumulator>,
  index: number,
  functionCall: { name?: string; args?: unknown }
): void {
  accumulators.set(index, {
    name: functionCall.name ?? '',
    args: (functionCall.args as Record<string, unknown>) ?? {},
  });
}

/**
 * Finalize accumulated tool calls
 */
export function finalizeToolCalls(
  accumulators: Map<number, StreamingFunctionCallAccumulator>
): ToolCallRequest[] {
  const calls: ToolCallRequest[] = [];

  for (const [index, acc] of Array.from(accumulators.entries()).sort(([a], [b]) => a - b)) {
    calls.push({
      callId: `gemini-call-${Date.now()}-${index}`,
      name: acc.name,
      arguments: acc.args,
    });
  }

  return calls;
}

/**
 * Map finish reason from Gemini to provider-agnostic format
 */
export function mapStopReasonFromGemini(
  finishReason: string | undefined
): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | undefined {
  switch (finishReason) {
    case 'STOP':
      return 'end_turn';
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER':
      return 'stop_sequence';
    default:
      return undefined;
  }
}

/**
 * Create a function response part for tool results
 */
export function createFunctionResponsePart(
  name: string,
  response: unknown
): Part {
  return {
    functionResponse: {
      name,
      response: response as Record<string, unknown>,
    },
  };
}
