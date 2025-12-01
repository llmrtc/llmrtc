import OpenAI, { toFile } from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message,
  STTProvider,
  STTResult,
  TTSProvider,
  TTSConfig,
  TTSResult
} from '@metered/llmrtc-core';
import {
  mapToolsToOpenAI,
  mapToolChoiceToOpenAI,
  parseToolCallsFromOpenAI,
  mapStopReasonFromOpenAI,
  processToolCallDelta,
  finalizeToolCalls,
  StreamingToolCallAccumulator,
} from './tool-adapter.js';

export interface OpenAILLMConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai-llm';
  private client: OpenAI;
  private model: string;

  constructor(private readonly config: OpenAILLMConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'gpt-4o-mini';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: false,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });
    const choice = completion.choices?.[0];
    const fullText = choice?.message?.content ?? '';
    const toolCalls = parseToolCallsFromOpenAI(choice?.message?.tool_calls);
    const stopReason = mapStopReasonFromOpenAI(choice?.finish_reason);

    return { fullText, raw: completion, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: true,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });

    // Accumulate tool calls across streaming chunks
    const toolCallAccumulators = new Map<number, StreamingToolCallAccumulator>();
    let finishReason: string | null = null;

    for await (const part of stream) {
      const choice = part.choices?.[0];
      const delta = choice?.delta;

      // Accumulate tool call deltas
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          processToolCallDelta(toolCallAccumulators, toolCallDelta);
        }
      }

      // Track finish reason
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      // Yield content delta
      const content = delta?.content ?? '';
      yield { content, done: false, raw: part };
    }

    // Final chunk with accumulated tool calls
    const toolCalls = toolCallAccumulators.size > 0
      ? finalizeToolCalls(toolCallAccumulators)
      : undefined;
    const stopReason = mapStopReasonFromOpenAI(finishReason);

    yield { content: '', done: true, toolCalls, stopReason };
  }
}

export interface OpenAIWhisperConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  language?: string;
}

export class OpenAIWhisperProvider implements STTProvider {
  readonly name = 'openai-whisper';
  private client: OpenAI;
  private model: string;
  private language?: string;

  constructor(config: OpenAIWhisperConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'whisper-1';
    this.language = config.language;
  }

  async transcribe(audio: Buffer): Promise<STTResult> {
    // Use OpenAI SDK's toFile helper for cross-platform compatibility
    const file = await toFile(audio, 'audio.webm', { type: 'audio/webm' });
    const res = await this.client.audio.transcriptions.create({
      file: file,
      model: this.model,
      language: this.language
    });
    return { text: res.text ?? '', isFinal: true, raw: res };
  }
}

function mapMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    // Handle tool result messages
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      } as ChatCompletionToolMessageParam;
    }

    // Handle assistant messages (may contain tool_calls reference for context)
    if (m.role === 'assistant') {
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || null,
      };

      // Include tool_calls if present (required for tool result messages to work)
      if (m.toolCalls?.length) {
        assistantMsg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.callId,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return assistantMsg;
    }

    // Handle system and user messages
    if (!m.attachments?.length) {
      return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    }
    const imageParts = m.attachments.map((att) => ({ type: 'image_url' as const, image_url: { url: att.data } }));
    return { role: m.role, content: [{ type: 'text' as const, text: m.content }, ...imageParts] } as ChatCompletionMessageParam;
  });
}

// =============================================================================
// OpenAI TTS Provider
// =============================================================================

export type OpenAITTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
export type OpenAITTSFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export interface OpenAITTSConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Base URL for API (optional, for Azure OpenAI or proxies) */
  baseURL?: string;
  /** TTS model (default: 'tts-1') */
  model?: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts';
  /** Default voice (default: 'alloy') */
  voice?: OpenAITTSVoice;
  /** Speech speed multiplier 0.25-4.0 (default: 1.0) */
  speed?: number;
}

/**
 * OpenAI Text-to-Speech Provider.
 *
 * Available voices: alloy, echo, fable, onyx, nova, shimmer
 * Available models: tts-1 (fast), tts-1-hd (quality), gpt-4o-mini-tts (instructable)
 *
 * @example
 * ```typescript
 * const provider = new OpenAITTSProvider({
 *   apiKey: 'sk-...',
 *   model: 'tts-1',
 *   voice: 'nova'
 * });
 * ```
 */
export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai-tts';
  private client: OpenAI;
  private model: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts';
  private voice: OpenAITTSVoice;
  private speed: number;

  constructor(private readonly config: OpenAITTSConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'tts-1';
    this.voice = config.voice ?? 'alloy';
    this.speed = config.speed ?? 1.0;
  }

  async speak(text: string, overrideConfig?: TTSConfig): Promise<TTSResult> {
    const voice = (overrideConfig?.voice as OpenAITTSVoice) ?? this.voice;
    const format = mapFormat(overrideConfig?.format);

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice,
      input: text,
      response_format: format,
      speed: this.speed
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      audio: buffer,
      format: overrideConfig?.format ?? 'mp3',
      raw: response
    };
  }

  /**
   * Streaming TTS - returns audio chunks as they are generated.
   * Uses HTTP chunked transfer encoding.
   *
   * When using format: 'pcm', output is 24kHz, 16-bit signed LE, mono.
   * This is the recommended format for lowest latency (no decode step needed).
   */
  async *speakStream(text: string, overrideConfig?: TTSConfig): AsyncIterable<Buffer> {
    const voice = (overrideConfig?.voice as OpenAITTSVoice) ?? this.voice;
    const format = mapFormat(overrideConfig?.format);

    const response = await this.client.audio.speech.create({
      model: this.model,
      voice,
      input: text,
      response_format: format,
      speed: this.speed
    });

    // Response is a Response-like object with body stream
    const reader = response.body?.getReader();
    if (!reader) {
      // Fallback: return the whole buffer if streaming not available
      const buffer = Buffer.from(await response.arrayBuffer());
      yield buffer;
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield Buffer.from(value);
    }
  }
}

/**
 * Map core format to OpenAI format
 */
function mapFormat(format?: TTSConfig['format']): OpenAITTSFormat {
  switch (format) {
    case 'ogg':
      return 'opus'; // OpenAI uses 'opus' for Ogg container
    case 'wav':
      return 'wav';
    case 'pcm':
      return 'pcm';
    case 'mp3':
    default:
      return 'mp3';
  }
}
