import fetch, { RequestInit } from 'node-fetch';
import FormData from 'form-data';
import {
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  STTProvider,
  STTResult,
  TTSProvider,
  TTSResult,
  VisionProvider,
  VisionRequest,
  VisionResult
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToOllama,
  parseToolCallsFromOllama,
  mapStopReasonFromOllama,
} from './tool-adapter.js';

export interface OllamaConfig {
  model?: string;
  baseUrl?: string;
}

/** Shape of a message in Ollama's /api/chat request/response. */
interface OllamaChatMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
}

/** Shape of an /api/chat response object (one NDJSON line when streaming). */
interface OllamaChatResponse {
  message?: OllamaChatMessage;
  done?: boolean;
  done_reason?: string;
}

export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama-llm';
  private readonly model: string;
  private readonly baseUrl: string;
  private modelCapabilities: string[] | null = null;

  constructor(config: OllamaConfig = {}) {
    this.model = config.model ?? 'llama3.1';
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  /**
   * Check if the current model supports vision capabilities.
   * Uses Ollama's /api/show endpoint which returns a capabilities array.
   * Results are cached to avoid repeated API calls.
   */
  private async checkVisionSupport(): Promise<boolean> {
    if (this.modelCapabilities === null) {
      try {
        const resp = await fetch(`${this.baseUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model })
        });
        if (resp.ok) {
          const data = (await resp.json()) as { capabilities?: string[] };
          this.modelCapabilities = data.capabilities ?? [];
        } else {
          this.modelCapabilities = [];
        }
      } catch {
        // Transient network failure: leave the cache unset so the next call
        // retries instead of permanently reporting "no vision support"
        return false;
      }
    }
    return this.modelCapabilities.includes('vision');
  }

  /**
   * Normalize image data - extract base64 from data URI if present.
   * Ollama expects raw base64, not data URIs.
   */
  private normalizeImageData(data: string): string {
    const match = data.match(/^data:[^;]+;base64,(.+)$/);
    return match ? match[1] : data;
  }

  /**
   * Build the /api/chat request body, honoring the request's sampling config.
   */
  private buildBody(request: LLMRequest, stream: boolean, supportsVision: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      stream,
      messages: this.mapMessages(request.messages, supportsVision),
    };
    if (request.tools?.length) {
      body.tools = mapToolsToOllama(request.tools);
    }
    const options: Record<string, unknown> = {};
    if (request.config?.temperature !== undefined) options.temperature = request.config.temperature;
    if (request.config?.topP !== undefined) options.top_p = request.config.topP;
    if (request.config?.maxTokens !== undefined) options.num_predict = request.config.maxTokens;
    if (Object.keys(options).length > 0) {
      body.options = options;
    }
    return body;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const supportsVision = await this.checkVisionSupport();
    const res = await this.call(request, false, supportsVision);
    const fullText = res.message?.content ?? '';
    const toolCalls = parseToolCallsFromOllama(res.message?.tool_calls);
    const stopReason = mapStopReasonFromOllama(res.message ?? {});
    return { fullText, raw: res, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const supportsVision = await this.checkVisionSupport();
    const body = this.buildBody(request, true, supportsVision);

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ollama stream failed: ${res.status} ${text}`);
    }
    if (!res.body) throw new Error('ollama stream missing body');

    // Tool calls can appear on any intermediate chunk (the final done:true
    // chunk usually carries an empty message), so collect them as they come.
    const collectedToolCalls: NonNullable<OllamaChatMessage['tool_calls']> = [];
    let doneReason: string | undefined;

    // NDJSON lines can be split across network chunks; carry the incomplete
    // tail over to the next chunk instead of dropping it. TextDecoder keeps
    // multi-byte characters intact across chunk boundaries.
    const decoder = new TextDecoder();
    let pending = '';

    const parseLine = function* (line: string): Generator<LLMChunk> {
      let parsed: OllamaChatResponse;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed.message?.tool_calls?.length) {
        collectedToolCalls.push(...parsed.message.tool_calls);
      }
      if (parsed.done_reason) {
        doneReason = parsed.done_reason;
      }
      const content = parsed.message?.content ?? '';
      if (content) yield { content, done: false, raw: parsed };
    };

    for await (const chunk of res.body as unknown as AsyncIterable<Buffer | string>) {
      pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield* parseLine(line);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) yield* parseLine(pending);

    // Final chunk with all collected tool calls
    const toolCalls = collectedToolCalls.length
      ? parseToolCallsFromOllama(collectedToolCalls)
      : undefined;
    const stopReason = toolCalls?.length
      ? ('tool_use' as const)
      : doneReason === 'length'
        ? ('max_tokens' as const)
        : ('end_turn' as const);
    yield { content: '', done: true, toolCalls, stopReason };
  }

  /**
   * Map messages to Ollama format, optionally including vision attachments.
   * @param messages - The messages to map
   * @param supportsVision - Whether the model supports vision (from checkVisionSupport)
   */
  private mapMessages(messages: LLMRequest['messages'], supportsVision: boolean): OllamaChatMessage[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool', content: m.content };
      }

      const mapped: OllamaChatMessage = { role: m.role, content: m.content };

      // Replay assistant tool calls so multi-turn tool conversations keep
      // their call/result pairing
      if (m.role === 'assistant' && m.toolCalls?.length) {
        mapped.tool_calls = m.toolCalls.map(tc => ({
          function: { name: tc.name, arguments: tc.arguments as Record<string, unknown> }
        }));
      }

      // Handle vision attachments for multimodal models (Gemma 3, LLaVA, etc.)
      if (m.attachments?.length) {
        if (!supportsVision) {
          throw new Error(
            `Model "${this.model}" does not support vision. ` +
            `Use a vision-capable model like gemma3, llava, or llama3.2-vision.`
          );
        }
        mapped.images = m.attachments.map((a) => this.normalizeImageData(a.data));
      }

      return mapped;
    });
  }

  private async call(
    request: LLMRequest,
    stream: boolean,
    supportsVision: boolean
  ): Promise<OllamaChatResponse> {
    const body = this.buildBody(request, stream, supportsVision);

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ollama failed: ${resp.status} ${text}`);
    }
    return (await resp.json()) as OllamaChatResponse;
  }
}

export interface FasterWhisperConfig {
  baseUrl?: string;
  language?: string;
  model?: string;
}

export class FasterWhisperProvider implements STTProvider {
  readonly name = 'faster-whisper';
  private readonly baseUrl: string;
  private readonly language?: string;
  private readonly model?: string;

  constructor(config: FasterWhisperConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:9000';
    this.language = config.language;
    this.model = config.model;
  }

  async transcribe(audio: Buffer): Promise<STTResult> {
    const form = new FormData();
    form.append('file', audio, { filename: 'audio.wav', contentType: 'audio/wav' });
    if (this.language) form.append('language', this.language);
    if (this.model) form.append('model', this.model);

    const resp = await fetch(`${this.baseUrl}/asr`, {
      method: 'POST',
      body: form as unknown as RequestInit['body']
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`faster-whisper failed: ${resp.status} ${text}`);
    }
    const json = (await resp.json()) as { text: string };
    return { text: json.text, isFinal: true, raw: json };
  }
}

export interface PiperConfig {
  baseUrl?: string;
  voice?: string;
}

export class PiperTTSProvider implements TTSProvider {
  readonly name = 'piper-tts';
  private readonly baseUrl: string;
  private readonly voice?: string;

  constructor(config: PiperConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:5002';
    this.voice = config.voice;
  }

  async speak(text: string): Promise<TTSResult> {
    const resp = await fetch(`${this.baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: this.voice })
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(`piper failed: ${resp.status} ${msg}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { audio: buffer, format: 'wav' };
  }
}

export interface LlavaConfig {
  baseUrl?: string;
  model?: string;
}

export class LlavaVisionProvider implements VisionProvider {
  readonly name = 'llava-vision';
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: LlavaConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.model = config.model ?? 'llava';
  }

  /** Ollama expects raw base64, not data URIs */
  private normalizeImageData(data: string): string {
    const match = data.match(/^data:[^;]+;base64,(.+)$/);
    return match ? match[1] : data;
  }

  async describe(request: VisionRequest): Promise<VisionResult> {
    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: request.prompt,
        // stream defaults to true on /api/generate; a streaming NDJSON body
        // would break the single json() parse below
        stream: false,
        images: request.attachments.map((a) => this.normalizeImageData(a.data))
      })
    });
    if (!resp.ok) {
      const msg = await resp.text();
      throw new Error(`llava failed: ${resp.status} ${msg}`);
    }
    const json = (await resp.json()) as { response: string };
    return { content: json.response, raw: json };
  }
}
