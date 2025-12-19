import { GoogleGenAI } from '@google/genai';
import type { Content, Part, GenerateContentConfig } from '@google/genai';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToGemini,
  mapToolChoiceToGemini,
  parseToolCallsFromGemini,
  mapStopReasonFromGemini,
  processStreamingFunctionCall,
  finalizeToolCalls,
  createFunctionResponsePart,
  StreamingFunctionCallAccumulator,
} from './tool-adapter.js';

export interface GeminiConfig {
  /** Google AI API key */
  apiKey: string;
  /** Model name (default: 'gemini-2.5-flash') */
  model?: string;
}

/**
 * Google Gemini LLM Provider.
 *
 * Uses the new @google/genai SDK (recommended over the deprecated @google/generative-ai).
 * Supports Gemini 2.0+ models with multimodal capabilities.
 *
 * @example
 * ```typescript
 * const provider = new GeminiLLMProvider({
 *   apiKey: 'AIza...',
 *   model: 'gemini-2.5-flash'
 * });
 * ```
 */
export class GeminiLLMProvider implements LLMProvider {
  readonly name = 'gemini-llm';
  private client: GoogleGenAI;
  private model: string;

  constructor(private readonly config: GeminiConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model ?? 'gemini-2.5-flash';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const { systemInstruction, contents } = convertMessages(request.messages);

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: request.config?.temperature,
        topP: request.config?.topP,
        maxOutputTokens: request.config?.maxTokens,
        ...(request.tools?.length && {
          tools: mapToolsToGemini(request.tools),
          toolConfig: {
            functionCallingConfig: mapToolChoiceToGemini(request.toolChoice, request.tools),
          },
        }),
      } as GenerateContentConfig
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;
    const fullText = response.text ?? '';
    const toolCalls = parseToolCallsFromGemini(parts);
    const stopReason = toolCalls?.length
      ? 'tool_use' as const
      : mapStopReasonFromGemini(candidate?.finishReason);

    return { fullText, raw: response, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const { systemInstruction, contents } = convertMessages(request.messages);

    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      config: {
        systemInstruction,
        temperature: request.config?.temperature,
        topP: request.config?.topP,
        maxOutputTokens: request.config?.maxTokens,
        ...(request.tools?.length && {
          tools: mapToolsToGemini(request.tools),
          toolConfig: {
            functionCallingConfig: mapToolChoiceToGemini(request.toolChoice, request.tools),
          },
        }),
      } as GenerateContentConfig
    });

    // Accumulate function calls across streaming chunks
    const functionCallAccumulators = new Map<number, StreamingFunctionCallAccumulator>();
    let finishReason: string | undefined;

    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      // Process function calls
      let callIndex = 0;
      for (const part of parts) {
        if (part.functionCall) {
          processStreamingFunctionCall(functionCallAccumulators, callIndex, part.functionCall);
          callIndex++;
        }
      }

      // Track finish reason
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }

      const text = chunk.text ?? '';
      yield { content: text, done: false, raw: chunk };
    }

    // Final chunk with accumulated tool calls
    const toolCalls = functionCallAccumulators.size > 0
      ? finalizeToolCalls(functionCallAccumulators)
      : undefined;
    const stopReason = toolCalls?.length
      ? 'tool_use' as const
      : mapStopReasonFromGemini(finishReason);

    yield { content: '', done: true, toolCalls, stopReason };
  }
}

/**
 * Convert our messages to Gemini format with system instruction extracted
 */
function convertMessages(messages: Message[]): {
  systemInstruction: string | undefined;
  contents: Content[];
} {
  let systemInstruction: string | undefined;
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction = msg.content;
      continue;
    }

    // Handle tool result messages
    if (msg.role === 'tool') {
      // Parse the tool result content as JSON if possible
      let response: unknown;
      try {
        response = JSON.parse(msg.content);
      } catch {
        response = { result: msg.content };
      }

      contents.push({
        role: 'user',
        parts: [createFunctionResponsePart(msg.toolName ?? '', response)],
      });
      continue;
    }

    const parts: Part[] = [];

    // Add text content
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    // Add vision attachments
    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        const { mimeType, data } = parseDataUri(att.data);
        parts.push({
          inlineData: {
            mimeType,
            data
          }
        });
      }
    }

    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts
    });
  }

  return { systemInstruction, contents };
}

/**
 * Parse a data URI into mime type and base64 data
 */
function parseDataUri(uri: string): { mimeType: string; data: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  // If not a data URI, assume it's already base64 and default to jpeg
  return { mimeType: 'image/jpeg', data: uri };
}
