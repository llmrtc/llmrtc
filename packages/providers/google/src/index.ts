import { GoogleGenAI } from '@google/genai';
import type { Content, Part } from '@google/genai';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message
} from '@metered/llmrtc-core';

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
        maxOutputTokens: request.config?.maxTokens
      }
    });

    const fullText = response.text ?? '';
    return { fullText, raw: response };
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
        maxOutputTokens: request.config?.maxTokens
      }
    });

    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      yield { content: text, done: false, raw: chunk };
    }

    yield { content: '', done: true };
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
