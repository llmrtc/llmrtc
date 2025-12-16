import fetch from 'node-fetch';
import { TTSConfig, TTSProvider, TTSResult } from '@llmrtc/llmrtc-core';

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  format?: TTSConfig['format'];
}

/**
 * ElevenLabs Text-to-Speech Provider.
 *
 * Supports both standard and streaming TTS using ElevenLabs API.
 * The streaming endpoint uses HTTP chunked transfer encoding for
 * low-latency audio delivery.
 *
 * Available models:
 * - eleven_multilingual_v2: Highest quality, more nuanced expression
 * - eleven_flash_v2_5: Ultra-low 75ms latency for real-time applications
 *
 * @example
 * ```typescript
 * const provider = new ElevenLabsTTSProvider({
 *   apiKey: 'xi-...',
 *   voiceId: '21m00Tcm4TlvDq8ikWAM',
 *   modelId: 'eleven_flash_v2_5'
 * });
 * ```
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs-tts';
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly format: TTSConfig['format'];
  private readonly apiKey: string;

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey;
    // Default to Rachel's actual voice ID (not the name)
    this.voiceId = config.voiceId ?? '21m00Tcm4TlvDq8ikWAM';
    this.modelId = config.modelId ?? 'eleven_multilingual_v2';
    this.format = config.format ?? 'mp3';
  }

  async speak(text: string, config?: TTSConfig): Promise<TTSResult> {
    const voiceId = config?.voice ?? this.voiceId;
    const format = config?.format ?? this.format ?? 'mp3';
    const outputFormat = mapFormat(format);

    // ElevenLabs requires output_format as query parameter
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: this.modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 }
      })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`ElevenLabs TTS failed: ${resp.status} ${errorText}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    return { audio: buffer, format };
  }

  /**
   * Streaming TTS - returns audio chunks as they are generated.
   * Uses ElevenLabs /stream endpoint with HTTP chunked transfer encoding.
   * Ideal for real-time applications requiring low latency.
   *
   * When using format: 'pcm', output is 24kHz, 16-bit signed LE, mono.
   * This matches OpenAI TTS PCM format for consistent handling.
   */
  async *speakStream(text: string, config?: TTSConfig): AsyncIterable<Buffer> {
    const voiceId = config?.voice ?? this.voiceId;
    const format = config?.format ?? this.format ?? 'mp3';
    const outputFormat = mapFormat(format);

    // ElevenLabs requires output_format as query parameter, not in body
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${outputFormat}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: this.modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 }
      })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`ElevenLabs TTS stream failed: ${resp.status} ${errorText}`);
    }

    if (!resp.body) {
      throw new Error('ElevenLabs TTS stream: No response body');
    }

    // Node.js ReadableStream from node-fetch
    for await (const chunk of resp.body as AsyncIterable<Buffer>) {
      yield Buffer.from(chunk);
    }
  }
}

/**
 * Map core format to ElevenLabs format string.
 * ElevenLabs uses format strings like 'mp3_44100_128' or 'pcm_24000'.
 *
 * PCM uses 24kHz to match OpenAI TTS output for consistent resampling.
 */
function mapFormat(format: TTSConfig['format']): string {
  switch (format) {
    case 'mp3':
      return 'mp3_44100_128';
    case 'ogg':
      return 'ogg_44100';
    case 'wav':
      return 'pcm_24000'; // Raw PCM, 24kHz to match OpenAI
    case 'pcm':
      return 'pcm_24000'; // 24kHz to match OpenAI TTS
    default:
      return 'mp3_44100_128';
  }
}
