import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'stream';

/**
 * Decode audio (MP3, WAV, etc.) to raw PCM for RTCAudioSource
 *
 * Output format:
 * - Sample rate: 48000 Hz (standard for WebRTC)
 * - Channels: 1 (mono)
 * - Bit depth: 16-bit signed little-endian (s16le)
 */
export async function decodeToPCM(
  audioBuffer: Buffer,
  inputFormat: string = 'mp3'
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const input = new Readable({
      read() {
        this.push(audioBuffer);
        this.push(null);
      }
    });

    const chunks: Buffer[] = [];
    const output = new PassThrough();

    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);

    ffmpeg(input)
      .inputFormat(inputFormat)
      .audioFrequency(48000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('s16le')
      .on('error', (err) => {
        reject(new Error(`FFmpeg decode error: ${err.message}`));
      })
      .pipe(output, { end: true });
  });
}

export interface FeedAudioOptions {
  /** AbortSignal to cancel playback mid-stream */
  signal?: AbortSignal;
  /** Callback when playback completes (not called if aborted) */
  onComplete?: () => void;
}

/**
 * Feed PCM audio to RTCAudioSource in 10ms chunks
 *
 * RTCAudioSource expects audio in 10ms frames at a consistent rate.
 * For 48kHz mono audio, that's 480 samples (960 bytes) per frame.
 *
 * @param pcmBuffer - Raw PCM audio (s16le, 48kHz, mono)
 * @param audioSource - RTCAudioSource instance
 * @param options - Optional settings including AbortSignal for cancellation
 * @returns true if completed normally, false if aborted
 */
export async function feedAudioToSource(
  pcmBuffer: Buffer,
  audioSource: any,
  options?: FeedAudioOptions
): Promise<boolean> {
  const { signal, onComplete } = options ?? {};
  const SAMPLE_RATE = 48000;
  const SAMPLES_PER_10MS = SAMPLE_RATE / 100; // 480 samples
  const BYTES_PER_SAMPLE = 2; // 16-bit

  // Convert buffer to Int16Array
  const int16Array = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / BYTES_PER_SAMPLE
  );

  // Feed in 10ms chunks
  for (let i = 0; i < int16Array.length; i += SAMPLES_PER_10MS) {
    // Check if cancelled before each chunk
    if (signal?.aborted) {
      console.log('[mp3-decoder] TTS playback aborted');
      return false;
    }

    const remaining = int16Array.length - i;
    const frameSize = Math.min(SAMPLES_PER_10MS, remaining);
    const chunk = int16Array.slice(i, i + frameSize);

    // Pad last frame if needed
    let samples: Int16Array;
    if (chunk.length < SAMPLES_PER_10MS) {
      samples = new Int16Array(SAMPLES_PER_10MS);
      samples.set(chunk);
    } else {
      samples = chunk;
    }

    audioSource.onData({
      samples,
      sampleRate: SAMPLE_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: samples.length
    });

    // Wait 10ms to maintain real-time playback rate
    await sleep(10);
  }

  onComplete?.();
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
