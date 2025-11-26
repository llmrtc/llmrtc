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
} from '@metered/llmrtc-core';

export interface OllamaConfig {
  model?: string;
  baseUrl?: string;
}

export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama-llm';
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OllamaConfig = {}) {
    this.model = config.model ?? 'llama3.1';
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const res: any = await this.call(request, false);
    const fullText = res.message?.content ?? '';
    return { fullText, raw: res };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    if (!res.body) throw new Error('ollama stream missing body');
    for await (const chunk of res.body as any as AsyncIterable<Buffer>) {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          const content = parsed?.message?.content ?? '';
          if (content) yield { content, done: false, raw: parsed };
        } catch (_) {
          continue;
        }
      }
    }
    yield { content: '', done: true };
  }

  private async call(request: LLMRequest, stream: boolean) {
    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });
    if (!resp.ok) throw new Error(`ollama failed: ${resp.status}`);
    return resp.json();
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

  async describe(request: VisionRequest): Promise<VisionResult> {
    const resp = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: request.prompt,
        images: request.attachments.map((a) => a.data)
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
