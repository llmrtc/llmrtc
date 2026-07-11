import { describe, it, expect, vi } from 'vitest';
import { AudioProcessor, AudioFrameQueue } from '../src/audio-processor.js';
import { VoicePlaybookOrchestrator } from '../src/voice-playbook-orchestrator.js';
import { ToolRegistry } from '@llmrtc/llmrtc-core';
import type {
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMChunk,
  STTResult,
  Playbook
} from '@llmrtc/llmrtc-core';

describe('AudioFrameQueue', () => {
  it('delivers frames pushed before consumption', async () => {
    const queue = new AudioFrameQueue();
    queue.push(Buffer.from('a'));
    queue.push(Buffer.from('b'));
    queue.end();

    const out: string[] = [];
    for await (const frame of queue) {
      out.push(frame.toString());
    }
    expect(out).toEqual(['a', 'b']);
  });

  it('wakes a waiting consumer when a frame arrives', async () => {
    const queue = new AudioFrameQueue();
    const consumed: Promise<string[]> = (async () => {
      const out: string[] = [];
      for await (const frame of queue) {
        out.push(frame.toString());
      }
      return out;
    })();

    await new Promise((r) => setTimeout(r, 5));
    queue.push(Buffer.from('late'));
    queue.end();

    expect(await consumed).toEqual(['late']);
  });

  it('ignores frames pushed after end', async () => {
    const queue = new AudioFrameQueue();
    queue.push(Buffer.from('kept'));
    queue.end();
    queue.push(Buffer.from('dropped'));

    const out: string[] = [];
    for await (const frame of queue) {
      out.push(frame.toString());
    }
    expect(out).toEqual(['kept']);
  });
});

describe('AudioProcessor speech-frame tee', () => {
  function makeAudioData(samples: Int16Array, sampleRate = 48000, channelCount = 1) {
    return {
      samples,
      sampleRate,
      bitsPerSample: 16,
      channelCount,
      numberOfFrames: samples.length / channelCount
    };
  }

  it('emits no speechFrame events when the tee is disabled', async () => {
    const processor = new AudioProcessor();
    const frames: Buffer[] = [];
    processor.on('speechFrame', (f: Buffer) => frames.push(f));

    await processor.processPCMData(makeAudioData(new Int16Array(480)));

    expect(frames).toHaveLength(0);
  });

  it('buffers pre-speech audio and emits live frames while speaking', async () => {
    const processor = new AudioProcessor({ emitSpeechFrames: true });
    const frames: Buffer[] = [];
    processor.on('speechFrame', (f: Buffer) => frames.push(f));

    // Not speaking: frames land in the pre-speech buffer, nothing emitted
    await processor.processPCMData(makeAudioData(new Int16Array(480)));
    expect(frames).toHaveLength(0);

    // Speaking: frames are emitted live
    (processor as unknown as { isSpeaking: boolean }).isSpeaking = true;
    await processor.processPCMData(makeAudioData(new Int16Array(480)));
    expect(frames).toHaveLength(1);
    // 480 samples at 48kHz -> 160 samples (320 bytes) at 16kHz
    expect(frames[0].length).toBe(320);
  });

  it('resamples to the configured rate and downmixes stereo', async () => {
    const processor = new AudioProcessor({
      emitSpeechFrames: true,
      speechFrameSampleRate: 24000
    });
    const frames: Buffer[] = [];
    processor.on('speechFrame', (f: Buffer) => frames.push(f));
    (processor as unknown as { isSpeaking: boolean }).isSpeaking = true;

    // Stereo: L=1000, R=3000 everywhere -> mono 2000
    const stereo = new Int16Array(960);
    for (let i = 0; i < 480; i++) {
      stereo[i * 2] = 1000;
      stereo[i * 2 + 1] = 3000;
    }
    await processor.processPCMData(makeAudioData(stereo, 48000, 2));

    // 480 stereo frames at 48kHz -> 240 mono samples (480 bytes) at 24kHz
    expect(frames[0].length).toBe(480);
    expect(frames[0].readInt16LE(0)).toBe(2000);
    expect(frames[0].readInt16LE(238 * 2)).toBe(2000);
  });

  it('emits destroyed on teardown so live streams can be closed', async () => {
    const processor = new AudioProcessor({ emitSpeechFrames: true });
    const queue = new AudioFrameQueue();
    processor.on('speechFrame', (f: Buffer) => queue.push(f));
    processor.on('destroyed', () => queue.end());
    (processor as unknown as { isSpeaking: boolean }).isSpeaking = true;
    await processor.processPCMData(makeAudioData(new Int16Array(480)));

    const consumed = (async () => {
      const out: Buffer[] = [];
      for await (const frame of queue) {
        out.push(frame);
      }
      return out;
    })();

    // Mid-speech disconnect: destroy must terminate the frame stream
    processor.destroy();

    expect((await consumed)).toHaveLength(1);
  });

  it('caps the pre-speech buffer', async () => {
    const processor = new AudioProcessor({
      emitSpeechFrames: true,
      preSpeechBufferMs: 20 // 640 bytes at 16kHz
    });
    // 10ms 48kHz frames -> 320 bytes each at 16kHz
    for (let i = 0; i < 10; i++) {
      await processor.processPCMData(makeAudioData(new Int16Array(480)));
    }
    const state = processor as unknown as { preSpeechBytes: number };
    expect(state.preSpeechBytes).toBeLessThanOrEqual(640);
  });
});

describe('VoicePlaybookOrchestrator streaming STT', () => {
  function makeProviders(sttResults: STTResult[]) {
    const llmRequests: LLMRequest[] = [];
    const llm: LLMProvider = {
      name: 'mock-llm',
      async complete(request: LLMRequest) {
        llmRequests.push(request);
        return { fullText: 'Sure, done.' };
      },
      async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
        llmRequests.push(request);
        yield { content: 'Sure, done.', done: false };
        yield { content: '', done: true };
      }
    };
    const stt: STTProvider = {
      name: 'mock-streaming-stt',
      async transcribe() {
        return { text: 'buffered', isFinal: true };
      },
      async *transcribeStream(audio: AsyncIterable<Buffer>) {
        for await (const _ of audio) {
          // drain
        }
        for (const result of sttResults) {
          yield result;
        }
      }
    };
    const tts: TTSProvider = {
      name: 'mock-tts',
      speak: vi.fn(async (text: string) => ({
        audio: Buffer.from(`tts:${text}`),
        format: 'mp3' as const
      }))
    };
    return { llm, stt, tts, llmRequests };
  }

  const playbook: Playbook = {
    id: 'p',
    name: 'P',
    initialStage: 'main',
    stages: [{ id: 'main', name: 'Main', systemPrompt: 'Help.', description: 'main' }],
    transitions: []
  };

  async function* frames(...chunks: string[]): AsyncGenerator<Buffer> {
    for (const chunk of chunks) {
      yield Buffer.from(chunk);
    }
  }

  it('yields interim transcripts then runs the playbook turn on the final text', async () => {
    const { llm, stt, tts, llmRequests } = makeProviders([
      { text: 'book a', isFinal: false },
      { text: 'book a table', isFinal: true }
    ]);
    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm, stt, tts },
      playbook,
      toolRegistry: new ToolRegistry()
    });

    const items: unknown[] = [];
    for await (const item of orchestrator.runTurnStreamFromAudioStream(frames('x'))) {
      items.push(item);
    }

    const transcripts = items.filter(
      (i): i is STTResult => typeof i === 'object' && i !== null && 'isFinal' in i
    );
    expect(transcripts.map((t) => [t.text, t.isFinal])).toEqual([
      ['book a', false],
      ['book a table', true]
    ]);
    expect(llmRequests.length).toBeGreaterThan(0);
    const userMessage = llmRequests[0].messages.findLast((m) => m.role === 'user');
    expect(userMessage?.content).toBe('book a table');
  });

  it('skips the playbook turn when the stream produced no speech', async () => {
    const { llm, stt, tts, llmRequests } = makeProviders([{ text: '', isFinal: true }]);
    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm, stt, tts },
      playbook,
      toolRegistry: new ToolRegistry()
    });

    const items: unknown[] = [];
    for await (const item of orchestrator.runTurnStreamFromAudioStream(frames('x'))) {
      items.push(item);
    }

    expect(llmRequests).toHaveLength(0);
    // Interim yield + tts-complete sentinel from the empty guard
    expect(items.some((i) => (i as { type?: string }).type === 'tts-complete')).toBe(true);
  });
});
