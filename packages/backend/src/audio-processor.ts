import { EventEmitter } from 'events';
import { RealTimeVAD } from 'avr-vad';

/**
 * AudioProcessor handles:
 * 1. Receiving PCM audio samples from RTCAudioSink (48kHz)
 * 2. Running Silero VAD to detect speech boundaries
 * 3. Using VAD's internal audio buffering (includes pre-speech padding)
 * 4. Emitting events on speech start/end
 * 5. Converting PCM to WAV for STT providers
 */
export interface AudioProcessorOptions {
  /**
   * Emit live 'speechFrame' events (16-bit mono PCM Buffers) while the
   * user is speaking, for streaming STT. Frames are resampled to
   * speechFrameSampleRate; a short pre-speech buffer is flushed on
   * speechStart so the first word isn't clipped. Default: false.
   */
  emitSpeechFrames?: boolean;
  /** Sample rate of emitted speech frames (default: 16000) */
  speechFrameSampleRate?: number;
  /** How much pre-speech audio to retain and flush on speechStart (default: 300ms) */
  preSpeechBufferMs?: number;
  /**
   * Realtime relay mode: emit every resampled frame as 'speechFrame'
   * regardless of VAD state (turn detection is provider-side). Implies
   * emitSpeechFrames; the pre-speech buffer is unused. Default: false.
   */
  passThrough?: boolean;
}

export class AudioProcessor extends EventEmitter {
  private outputSampleRate = 16000; // VAD outputs resampled 16kHz audio
  private channels = 1;
  private frameCount = 0;

  // VAD state
  private vad: RealTimeVAD | null = null;
  private vadInitialized = false;
  private isSpeaking = false;

  // Live speech-frame tee (streaming STT)
  private readonly emitSpeechFrames: boolean;
  private readonly speechFrameSampleRate: number;
  private readonly preSpeechBufferMaxBytes: number;
  private preSpeechFrames: Buffer[] = [];
  private preSpeechBytes = 0;

  private readonly passThrough: boolean;

  constructor(options: AudioProcessorOptions = {}) {
    super();
    this.passThrough = options.passThrough ?? false;
    this.emitSpeechFrames = this.passThrough || (options.emitSpeechFrames ?? false);
    this.speechFrameSampleRate = options.speechFrameSampleRate ?? 16000;
    const preSpeechMs = options.preSpeechBufferMs ?? 300;
    this.preSpeechBufferMaxBytes = Math.ceil((this.speechFrameSampleRate * 2 * preSpeechMs) / 1000);
  }

  /**
   * Initialize the VAD model (call once before processing)
   */
  async initVAD() {
    if (this.vadInitialized) return;

    try {
      this.vad = await RealTimeVAD.new({
        model: 'v5',
        sampleRate: 48000, // Input sample rate - VAD resamples internally to 16kHz
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        minSpeechFrames: 5,        // Require more frames to confirm speech start
        redemptionFrames: 50,      // Allow ~500ms of pause within speech (50 * 10ms)
        preSpeechPadFrames: 10,    // Include 100ms of audio before speech starts
        onFrameProcessed: () => {
          // Optional: could use for debugging
        },
        onVADMisfire: () => {
          // False positive: too short to be speech. Reset state so the
          // live frame stream (if any) can be discarded.
          this.isSpeaking = false;
          this.emit('vadMisfire');
        },
        onSpeechStart: () => {
          this.isSpeaking = true;
          console.log('[audio-processor] Speech started');
          this.emit('speechStart');
          // Flush buffered pre-speech audio into the live frame stream so
          // streaming STT hears the start of the first word
          if (this.emitSpeechFrames) {
            for (const frame of this.preSpeechFrames) {
              this.emit('speechFrame', frame);
            }
            this.preSpeechFrames = [];
            this.preSpeechBytes = 0;
          }
        },
        onSpeechRealStart: () => {
          // Speech confirmed after minimum frames
        },
        onSpeechEnd: (audio: Float32Array) => {
          // VAD provides the buffered audio (already resampled to 16kHz)
          // This includes pre-speech padding so we get the full utterance
          this.isSpeaking = false;
          const pcmBuffer = this.float32ToInt16Buffer(audio);
          console.log(`[audio-processor] Speech ended - PCM bytes: ${pcmBuffer.length}, samples: ${audio.length}`);
          this.emit('speechEnd', pcmBuffer);
        }
      });

      this.vad.start();
      this.vadInitialized = true;
      console.log('[audio-processor] Silero VAD initialized');
    } catch (err) {
      console.error('[audio-processor] Failed to initialize VAD:', err);
      throw err;
    }
  }

  /**
   * Process PCM samples from RTCAudioSink
   * Automatically detects speech and emits events
   */
  async processPCMData(data: {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
    numberOfFrames: number;
  }): Promise<void> {
    // Log audio format from first chunk
    if (this.frameCount === 0) {
      this.channels = data.channelCount;
      console.log(`[audio-processor] Audio format: ${data.sampleRate}Hz, ${this.channels} channel(s), ${data.bitsPerSample}-bit`);
    }

    this.frameCount++;

    // Tee for streaming STT: resample to the target rate and either emit
    // live (while speaking) or hold in the rolling pre-speech buffer
    if (this.emitSpeechFrames) {
      const frame = this.resampleToMono16(
        data.samples,
        data.sampleRate,
        data.channelCount || 1,
        this.speechFrameSampleRate
      );
      if (this.passThrough || this.isSpeaking) {
        this.emit('speechFrame', frame);
      } else {
        this.preSpeechFrames.push(frame);
        this.preSpeechBytes += frame.length;
        while (this.preSpeechBytes > this.preSpeechBufferMaxBytes && this.preSpeechFrames.length > 1) {
          this.preSpeechBytes -= this.preSpeechFrames.shift()!.length;
        }
      }
    }

    // Process through VAD - it handles speech detection and audio buffering
    // via callbacks. Skipped entirely (incl. the Float32 conversion) in
    // pass-through/relay mode where the VAD is never initialized.
    if (this.vad && this.vadInitialized) {
      const float32Samples = this.int16ToFloat32(data.samples);
      try {
        await this.vad.processAudio(float32Samples);
      } catch (err) {
        console.error('[audio-processor] VAD processing error:', err);
      }
    }
  }

  /**
   * Downmix interleaved samples to mono and linearly resample to the
   * target rate, returning 16-bit signed LE PCM. Linear interpolation
   * has no anti-alias filter; content above the target Nyquist folds
   * down, which current STT models tolerate well for speech.
   */
  private resampleToMono16(
    samples: Int16Array,
    sourceRate: number,
    channels: number,
    targetRate: number
  ): Buffer {
    const frames = Math.floor(samples.length / channels);
    let mono: Int16Array;
    if (channels === 1) {
      mono = samples;
    } else {
      mono = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          sum += samples[i * channels + c];
        }
        mono[i] = Math.round(sum / channels);
      }
    }
    if (sourceRate === targetRate) {
      const out = Buffer.alloc(mono.length * 2);
      for (let i = 0; i < mono.length; i++) {
        out.writeInt16LE(mono[i], i * 2);
      }
      return out;
    }
    const targetFrames = Math.floor((frames * targetRate) / sourceRate);
    const out = Buffer.alloc(targetFrames * 2);
    for (let i = 0; i < targetFrames; i++) {
      const pos = (i * sourceRate) / targetRate;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, frames - 1);
      const frac = pos - i0;
      out.writeInt16LE(Math.round(mono[i0] + (mono[i1] - mono[i0]) * frac), i * 2);
    }
    return out;
  }

  /**
   * Convert Int16 samples to Float32 (range -1 to 1)
   */
  private int16ToFloat32(int16: Int16Array): Float32Array {
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }
    return float32;
  }

  /**
   * Convert Float32 samples to Int16 PCM Buffer
   */
  private float32ToInt16Buffer(float32: Float32Array): Buffer {
    const buffer = Buffer.alloc(float32.length * 2);
    for (let i = 0; i < float32.length; i++) {
      // Clamp to [-1, 1] and convert to Int16
      const sample = Math.max(-1, Math.min(1, float32[i]));
      const int16 = Math.round(sample * 32767);
      buffer.writeInt16LE(int16, i * 2);
    }
    return buffer;
  }

  /**
   * Convert PCM buffer to WAV format for STT providers
   * Uses 16kHz sample rate (VAD output)
   */
  pcmToWav(pcmBuffer: Buffer): Buffer {
    const header = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;
    const byteRate = this.outputSampleRate * this.channels * 2;
    const blockAlign = this.channels * 2;

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);

    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.outputSampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);

    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  /**
   * Force end of speech (e.g., when stopping audio sharing)
   * Flushes the VAD buffer which will trigger onSpeechEnd if there's pending audio
   */
  async forceEndSpeech(): Promise<void> {
    if (this.vad && this.isSpeaking) {
      console.log('[audio-processor] Forcing end of speech via VAD flush');
      await this.vad.flush();
    }
  }

  /**
   * Check if currently speaking
   */
  get speaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Clean up resources. Emits 'destroyed' so live speech-frame consumers
   * (streaming STT) can close their utterance stream when the connection
   * tears down mid-speech.
   */
  destroy() {
    this.isSpeaking = false;
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
    }
    this.vadInitialized = false;
    this.preSpeechFrames = [];
    this.preSpeechBytes = 0;
    this.emit('destroyed');
  }
}

/**
 * Push-based async queue bridging AudioProcessor speech-frame events to
 * the AsyncIterable consumed by STT transcribeStream implementations.
 * One instance carries one utterance: push() frames as they arrive and
 * end() the queue at speech end.
 */
export class AudioFrameQueue implements AsyncIterable<Buffer> {
  private frames: Buffer[] = [];
  private waiter: ((r: IteratorResult<Buffer>) => void) | null = null;
  private ended = false;

  push(frame: Buffer): void {
    if (this.ended) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: frame, done: false });
    } else {
      this.frames.push(frame);
    }
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined as unknown as Buffer, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Buffer> {
    return {
      next: (): Promise<IteratorResult<Buffer>> => {
        if (this.frames.length > 0) {
          return Promise.resolve({ value: this.frames.shift()!, done: false });
        }
        if (this.ended) {
          return Promise.resolve({ value: undefined as unknown as Buffer, done: true });
        }
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      }
    };
  }
}
