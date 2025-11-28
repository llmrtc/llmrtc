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

// =============================================================================
// Streaming PCM Support (for sentence-boundary TTS)
// =============================================================================

/**
 * Simple linear resampler: 24kHz → 48kHz
 * Uses linear interpolation for 2x upsampling.
 *
 * @param input - Input samples at 24kHz
 * @returns Output samples at 48kHz (2x length)
 */
function resample24to48(input: Int16Array): Int16Array {
  const output = new Int16Array(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const curr = input[i];
    const next = i < input.length - 1 ? input[i + 1] : curr;
    output[i * 2] = curr;
    output[i * 2 + 1] = Math.round((curr + next) / 2);
  }
  return output;
}

/**
 * State for streaming PCM feeder to handle partial frames across chunks
 */
export interface PCMFeederState {
  /** Leftover samples from previous chunk that didn't fill a full 10ms frame */
  pendingSamples: Int16Array;
  /** Leftover byte from previous chunk (if chunk had odd length) */
  pendingByte: number | null;
  /** Whether the feeder has been aborted */
  aborted: boolean;
}

/**
 * Create a new PCM feeder state
 */
export function createPCMFeederState(): PCMFeederState {
  return {
    pendingSamples: new Int16Array(0),
    pendingByte: null,
    aborted: false
  };
}

export interface FeedPCMChunkOptions {
  /** Sample rate of input PCM (default: 24000 for OpenAI/ElevenLabs) */
  inputSampleRate?: number;
  /** AbortSignal to cancel playback */
  signal?: AbortSignal;
}

/**
 * Feed a PCM chunk to RTCAudioSource with resampling support.
 *
 * Unlike feedAudioToSource, this:
 * - Handles a single chunk (not complete audio)
 * - Resamples from input sample rate (default 24kHz) to 48kHz
 * - Maintains state for partial frames across calls
 *
 * @param pcmChunk - Raw PCM chunk (16-bit signed LE) at input sample rate
 * @param audioSource - RTCAudioSource instance
 * @param state - Feeder state for buffering partial frames
 * @param options - Optional settings
 */
export async function feedPCMChunkToSource(
  pcmChunk: Buffer,
  audioSource: any,
  state: PCMFeederState,
  options?: FeedPCMChunkOptions
): Promise<void> {
  const { inputSampleRate = 24000, signal } = options ?? {};

  if (state.aborted || signal?.aborted) {
    state.aborted = true;
    return;
  }

  const OUTPUT_RATE = 48000;
  const SAMPLES_PER_10MS = OUTPUT_RATE / 100; // 480 samples at 48kHz

  // Handle pending byte from previous chunk (for odd-length chunks)
  let workingBuffer: Buffer;
  if (state.pendingByte !== null) {
    // Prepend the pending byte to current chunk
    workingBuffer = Buffer.alloc(1 + pcmChunk.length);
    workingBuffer[0] = state.pendingByte;
    pcmChunk.copy(workingBuffer, 1);
    state.pendingByte = null;
  } else {
    workingBuffer = pcmChunk;
  }

  // Handle odd-length buffer - save last byte for next chunk
  let byteLength = workingBuffer.length;
  if (byteLength % 2 !== 0) {
    state.pendingByte = workingBuffer[byteLength - 1];
    byteLength -= 1;
  }

  if (byteLength === 0) {
    return; // No complete samples to process
  }

  // Safely convert Buffer to Int16Array by copying to aligned ArrayBuffer
  // This avoids issues with Buffer's potentially unaligned underlying ArrayBuffer
  const alignedBuffer = new ArrayBuffer(byteLength);
  const alignedView = new Uint8Array(alignedBuffer);
  for (let i = 0; i < byteLength; i++) {
    alignedView[i] = workingBuffer[i];
  }
  const inputSamples = new Int16Array(alignedBuffer);

  // Resample to 48kHz if needed
  let samples48k: Int16Array;
  if (inputSampleRate === 24000) {
    samples48k = resample24to48(inputSamples);
  } else if (inputSampleRate === 48000) {
    samples48k = inputSamples;
  } else {
    // For other rates, use simple ratio resampling (basic)
    const ratio = OUTPUT_RATE / inputSampleRate;
    const outputLen = Math.floor(inputSamples.length * ratio);
    samples48k = new Int16Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      const srcIdx = Math.floor(i / ratio);
      samples48k[i] = inputSamples[Math.min(srcIdx, inputSamples.length - 1)];
    }
  }

  // Combine with pending samples from previous chunk
  const totalSamples = new Int16Array(state.pendingSamples.length + samples48k.length);
  totalSamples.set(state.pendingSamples);
  totalSamples.set(samples48k, state.pendingSamples.length);

  // Feed complete 10ms frames
  let offset = 0;
  while (offset + SAMPLES_PER_10MS <= totalSamples.length) {
    if (signal?.aborted) {
      state.aborted = true;
      return;
    }

    const frame = totalSamples.slice(offset, offset + SAMPLES_PER_10MS);
    audioSource.onData({
      samples: frame,
      sampleRate: OUTPUT_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: frame.length
    });

    offset += SAMPLES_PER_10MS;
    await sleep(10);
  }

  // Save remaining samples for next chunk
  state.pendingSamples = totalSamples.slice(offset);
}

/**
 * Flush any remaining samples in the feeder state.
 * Call this after the last chunk to ensure all audio is played.
 *
 * @param audioSource - RTCAudioSource instance
 * @param state - Feeder state containing pending samples
 */
export async function flushPCMFeeder(
  audioSource: any,
  state: PCMFeederState
): Promise<void> {
  if (state.aborted || state.pendingSamples.length === 0) {
    return;
  }

  const OUTPUT_RATE = 48000;
  const SAMPLES_PER_10MS = OUTPUT_RATE / 100;

  // Pad to complete frame and send
  const padded = new Int16Array(SAMPLES_PER_10MS);
  padded.set(state.pendingSamples);

  audioSource.onData({
    samples: padded,
    sampleRate: OUTPUT_RATE,
    bitsPerSample: 16,
    channelCount: 1,
    numberOfFrames: padded.length
  });

  state.pendingSamples = new Int16Array(0);
  await sleep(10);
}
