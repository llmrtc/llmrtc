import { EventEmitter } from 'events';

/**
 * AudioProcessor handles:
 * 1. Receiving PCM audio samples from RTCAudioSink
 * 2. Buffering PCM during speech
 * 3. Converting PCM to WAV for STT providers
 *
 * Note: RTCAudioSink (from @roamhq/wrtc nonstandard API) provides decoded PCM
 * samples directly, so no Opus decoding is needed here.
 */
export class AudioProcessor extends EventEmitter {
  private frameBuffer: Buffer[] = [];
  private isCapturing = false;
  private sampleRate = 48000; // Will be set from RTCAudioSink data
  private channels = 1; // Will be set from RTCAudioSink data
  private frameCount = 0;

  constructor() {
    super();
  }

  /**
   * Start capturing audio frames
   */
  startCapture() {
    this.isCapturing = true;
    this.frameBuffer = [];
    this.frameCount = 0;
    console.log('[audio-processor] Started capture');
  }

  /**
   * Stop capturing and return accumulated PCM buffer
   */
  stopCapture(): Buffer {
    this.isCapturing = false;
    const allPcm = Buffer.concat(this.frameBuffer);
    const frameCount = this.frameBuffer.length;
    this.frameBuffer = [];
    console.log(`[audio-processor] Stopped capture - frames: ${frameCount}, PCM bytes: ${allPcm.length}`);
    return allPcm;
  }

  get capturing(): boolean {
    return this.isCapturing;
  }

  /**
   * Process PCM samples from RTCAudioSink
   * RTCAudioSink.ondata provides:
   * - samples: Int16Array
   * - sampleRate: number (e.g., 48000)
   * - bitsPerSample: number (16)
   * - channelCount: number (1 or 2)
   * - numberOfFrames: number
   */
  processPCMData(data: {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
    numberOfFrames: number;
  }) {
    if (!this.isCapturing) return;

    // Update audio format from first chunk
    if (this.frameCount === 0) {
      this.sampleRate = data.sampleRate;
      this.channels = data.channelCount;
      console.log(`[audio-processor] Audio format: ${this.sampleRate}Hz, ${this.channels} channel(s), ${data.bitsPerSample}-bit`);
    }

    // Convert Int16Array to Buffer and store
    const pcmBuffer = Buffer.from(data.samples.buffer, data.samples.byteOffset, data.samples.byteLength);
    this.frameBuffer.push(pcmBuffer);
    this.frameCount++;
  }

  /**
   * Convert PCM buffer to WAV format for STT providers
   * WAV format: RIFF header + fmt chunk + data chunk
   */
  pcmToWav(pcmBuffer: Buffer): Buffer {
    const header = Buffer.alloc(44);
    const dataLength = pcmBuffer.length;
    const byteRate = this.sampleRate * this.channels * 2; // 16-bit = 2 bytes per sample
    const blockAlign = this.channels * 2;

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4); // File size - 8
    header.write('WAVE', 8);

    // fmt subchunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34); // BitsPerSample

    // data subchunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
  }

  /**
   * Get capture statistics
   */
  getStats() {
    return {
      isCapturing: this.isCapturing,
      frameCount: this.frameBuffer.length,
      sampleRate: this.sampleRate,
      channels: this.channels,
      // Estimate duration: total samples / sample rate
      estimatedDurationMs: this.frameBuffer.length > 0
        ? (this.frameBuffer.reduce((sum, buf) => sum + buf.length, 0) / 2 / this.sampleRate / this.channels) * 1000
        : 0
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.frameBuffer = [];
    this.isCapturing = false;
  }
}
