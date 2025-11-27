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
export class AudioProcessor extends EventEmitter {
  private outputSampleRate = 16000; // VAD outputs resampled 16kHz audio
  private channels = 1;
  private frameCount = 0;

  // VAD state
  private vad: RealTimeVAD | null = null;
  private vadInitialized = false;
  private isSpeaking = false;

  constructor() {
    super();
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
          // False positive detected
        },
        onSpeechStart: () => {
          this.isSpeaking = true;
          console.log('[audio-processor] Speech started');
          this.emit('speechStart');
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

    // Convert Int16 to Float32 for VAD
    const float32Samples = this.int16ToFloat32(data.samples);

    // Process through VAD - it handles speech detection and audio buffering via callbacks
    // The VAD internally buffers audio and provides it in onSpeechEnd callback
    if (this.vad && this.vadInitialized) {
      try {
        await this.vad.processAudio(float32Samples);
      } catch (err) {
        console.error('[audio-processor] VAD processing error:', err);
      }
    }
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
   * Clean up resources
   */
  destroy() {
    this.isSpeaking = false;
    if (this.vad) {
      this.vad.destroy();
      this.vad = null;
    }
    this.vadInitialized = false;
  }
}
