import fetch from 'node-fetch';
import { TTSConfig, TTSProvider, TTSResult } from '@metered/llmrtc-core';

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  format?: TTSConfig['format'];
}

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

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: this.modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        output_format: format
      })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`ElevenLabs TTS failed: ${resp.status} ${errorText}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    return { audio: buffer, format };
  }
}
