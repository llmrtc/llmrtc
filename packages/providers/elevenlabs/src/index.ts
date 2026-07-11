import fetch from 'node-fetch';
import WebSocket from 'ws';
import {
  AsyncEventQueue,
  STTConfig,
  STTProvider,
  STTResult,
  TTSConfig,
  TTSProvider,
  TTSResult
} from '@llmrtc/llmrtc-core';

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
  /** PCM output is pinned to 24kHz (matches OpenAI TTS for consistent handling) */
  readonly pcmSampleRate = 24000;
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

    let buffer: Buffer = Buffer.from(await resp.arrayBuffer());
    if (format === 'wav') {
      // ElevenLabs has no WAV output; it returns headerless 24kHz PCM.
      // Wrap it in a RIFF header so the result is actually a WAV file.
      buffer = pcmToWav(buffer, this.pcmSampleRate, 1, 16);
    }
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
      // ElevenLabs has no plain-ogg output; Ogg-Opus is the closest match
      return 'opus_48000_64';
    case 'wav':
      return 'pcm_24000'; // Raw PCM; speak() wraps it in a WAV header
    case 'pcm':
      return 'pcm_24000'; // 24kHz to match OpenAI TTS
    default:
      return 'mp3_44100_128';
  }
}

/**
 * Wrap raw PCM samples in a minimal RIFF/WAVE header.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// =============================================================================
// ElevenLabs Scribe STT Provider
// =============================================================================

export interface ElevenLabsScribeConfig {
  /** ElevenLabs API key */
  apiKey: string;
  /** Batch transcription model (default: 'scribe_v2') */
  modelId?: string;
  /** Realtime transcription model (default: 'scribe_v2_realtime') */
  realtimeModelId?: string;
  /** ISO language code hint (default: auto-detect) */
  languageCode?: string;
  /** HTTP API base (default: 'https://api.elevenlabs.io') */
  baseUrl?: string;
  /** WebSocket API base (default: derived from baseUrl) */
  wsBaseUrl?: string;
  /**
   * Realtime socket watchdog timeouts in ms. Defaults: connect 10000,
   * inactivity 30000, final-after-commit 15000. Mostly useful in tests.
   */
  timeoutsMs?: { connect?: number; inactivity?: number; final?: number };
}

interface ScribeRealtimeEvent {
  message_type?: string;
  text?: string;
  error?: string;
}

/**
 * ElevenLabs Scribe Speech-to-Text Provider.
 *
 * - transcribe(): batch transcription via POST /v1/speech-to-text
 *   (Scribe v2 by default - high accuracy, 90+ languages).
 * - transcribeStream(): realtime transcription via the Scribe v2 Realtime
 *   WebSocket API (sub-150ms partial transcripts). Input frames must be
 *   16kHz mono 16-bit signed LE PCM.
 *
 * @example
 * ```typescript
 * const stt = new ElevenLabsScribeProvider({
 *   apiKey: process.env.ELEVENLABS_API_KEY!
 * });
 * ```
 */
export class ElevenLabsScribeProvider implements STTProvider {
  readonly name = 'elevenlabs-scribe';
  /** Scribe realtime consumes 16kHz mono 16-bit PCM frames */
  readonly streamingInputSampleRate = 16000;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly realtimeModelId: string;
  private readonly languageCode?: string;
  private readonly baseUrl: string;
  private readonly wsBaseUrl: string;
  private readonly timeoutsMs: { connect: number; inactivity: number; final: number };

  constructor(config: ElevenLabsScribeConfig) {
    this.apiKey = config.apiKey;
    this.modelId = config.modelId ?? 'scribe_v2';
    this.realtimeModelId = config.realtimeModelId ?? 'scribe_v2_realtime';
    this.languageCode = config.languageCode;
    this.baseUrl = (config.baseUrl ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
    this.wsBaseUrl =
      config.wsBaseUrl ?? this.baseUrl.replace(/^http/, 'ws');
    this.timeoutsMs = {
      connect: config.timeoutsMs?.connect ?? 10000,
      inactivity: config.timeoutsMs?.inactivity ?? 30000,
      final: config.timeoutsMs?.final ?? 15000
    };
  }

  async transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult> {
    // Node 20+ global FormData/Blob; the endpoint sniffs the container,
    // the filename is a hint only
    const form = new FormData();
    form.append('model_id', config?.model ?? this.modelId);
    const filename =
      audio.length >= 4 && audio.toString('ascii', 0, 4) === 'RIFF'
        ? 'audio.wav'
        : 'audio.webm';
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    const language = config?.language ?? this.languageCode;
    if (language) {
      form.append('language_code', language);
    }

    const resp = await globalThis.fetch(`${this.baseUrl}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: form
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`ElevenLabs Scribe failed: ${resp.status} ${errorText}`);
    }

    const json = (await resp.json()) as { text?: string };
    return { text: json.text ?? '', isFinal: true, raw: json };
  }

  /**
   * Realtime transcription over the Scribe v2 Realtime WebSocket.
   * Yields partial transcripts (isFinal: false) as the user speaks and a
   * committed transcript (isFinal: true) once the audio stream ends.
   */
  async *transcribeStream(audio: AsyncIterable<Buffer>, config?: STTConfig): AsyncIterable<STTResult> {
    const params = new URLSearchParams({
      model_id: this.realtimeModelId,
      audio_format: 'pcm_16000',
      commit_strategy: 'manual'
    });
    const language = config?.language ?? this.languageCode;
    if (language) {
      params.set('language_code', language);
    }

    const ws = new WebSocket(
      `${this.wsBaseUrl}/v1/speech-to-text/realtime?${params.toString()}`,
      { headers: { 'xi-api-key': this.apiKey } }
    );

    const queue = new AsyncEventQueue<STTResult>();
    let finalReceived = false;
    let commitSent = false;

    // Watchdog: a silently-stalled socket must not hang the voice turn
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (ms: number, waitingFor: string) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        queue.fail(new Error(`ElevenLabs Scribe realtime timed out waiting for ${waitingFor}`));
        ws.terminate();
      }, ms);
      watchdog.unref?.();
    };
    const disarmWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    armWatchdog(this.timeoutsMs.connect, 'connection');

    ws.on('message', (data: WebSocket.RawData) => {
      armWatchdog(
        commitSent ? this.timeoutsMs.final : this.timeoutsMs.inactivity,
        commitSent ? 'the final transcript' : 'server messages'
      );
      let event: ScribeRealtimeEvent;
      try {
        event = JSON.parse(data.toString()) as ScribeRealtimeEvent;
      } catch {
        return;
      }
      switch (event.message_type) {
        case 'partial_transcript':
          queue.push({ text: event.text ?? '', isFinal: false, raw: event });
          break;
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          queue.push({ text: event.text ?? '', isFinal: true, raw: event });
          // With manual commit strategy the final commit ends the session
          if (commitSent) {
            finalReceived = true;
            queue.end();
            ws.close();
          }
          break;
        case 'session_started':
          break;
        default:
          if (event.error) {
            queue.fail(new Error(`ElevenLabs Scribe realtime ${event.message_type}: ${event.error}`));
            ws.close();
          }
      }
    });

    ws.on('error', (err: Error) => {
      queue.fail(new Error(`ElevenLabs Scribe realtime socket error: ${err.message}`));
    });

    ws.on('close', () => {
      disarmWatchdog();
      // A close before the final transcript means the utterance was lost;
      // surface it instead of silently producing an empty transcript
      // (no-op when the queue already ended or failed)
      if (!finalReceived) {
        queue.fail(new Error('ElevenLabs Scribe realtime connection closed before the final transcript'));
      }
    });

    const opened = new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
      ws.once('close', () => reject(new Error('socket closed before opening')));
    });

    // Feed audio frames in the background while transcripts are consumed
    const sendLoop = (async () => {
      await opened;
      armWatchdog(this.timeoutsMs.inactivity, 'server messages');
      let sentAny = false;
      for await (const frame of audio) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (frame.length === 0) continue;
        sentAny = true;
        ws.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: frame.toString('base64'),
            commit: false,
            sample_rate: this.streamingInputSampleRate
          })
        );
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!sentAny) {
        // Nothing to transcribe; committing an empty stream just errors
        finalReceived = true;
        queue.end();
        ws.close();
        return;
      }
      // End of audio: flush the segment into a committed transcript
      commitSent = true;
      armWatchdog(this.timeoutsMs.final, 'the final transcript');
      ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: '',
          commit: true,
          sample_rate: this.streamingInputSampleRate
        })
      );
    })().catch((err: Error) => {
      queue.fail(err);
      ws.close();
    });

    try {
      yield* queue;
    } finally {
      disarmWatchdog();
      // Close first: an abandoned sendLoop exits at its next frame once
      // the socket is no longer OPEN, instead of feeding a dead session
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      // sendLoop never rejects (errors route into the queue); the bounded
      // wait guards against a caller-owned frame iterable that never ends
      await Promise.race([
        sendLoop,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5000);
          t.unref?.();
        })
      ]);
    }
  }

}
