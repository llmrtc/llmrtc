import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationOrchestrator,
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMChunk,
  OrchestratorYield,
  STTResult,
  STTConfig
} from '../src/index.js';

class StreamingLLMStub implements LLMProvider {
  name = 'streaming-llm-stub';
  response = 'Hello there.';
  requests: LLMRequest[] = [];

  async complete(req: LLMRequest) {
    this.requests.push(req);
    return { fullText: this.response };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    this.requests.push(req);
    yield { content: this.response, done: false };
    yield { content: '', done: true };
  }
}

/** STT stub with a scripted transcribeStream. */
class StreamingSTTStub implements STTProvider {
  name = 'streaming-stt-stub';
  readonly streamingInputSampleRate = 16000;
  results: STTResult[] = [];
  receivedFrames: Buffer[] = [];
  streamCalls = 0;

  async transcribe(_audio: Buffer): Promise<STTResult> {
    return { text: 'buffered path', isFinal: true };
  }

  async *transcribeStream(audio: AsyncIterable<Buffer>, _config?: STTConfig): AsyncIterable<STTResult> {
    this.streamCalls++;
    for await (const frame of audio) {
      this.receivedFrames.push(frame);
    }
    for (const result of this.results) {
      yield result;
    }
  }
}

/** STT without streaming support. */
class BufferedOnlySTT implements STTProvider {
  name = 'buffered-only-stt';
  async transcribe(_audio: Buffer): Promise<STTResult> {
    return { text: 'buffered', isFinal: true };
  }
}

class TTSStub implements TTSProvider {
  name = 'tts-stub';
  speakCalls: string[] = [];

  async speak(text: string) {
    this.speakCalls.push(text);
    return { audio: Buffer.from('audio'), format: 'mp3' as const };
  }
}

async function* frames(...chunks: string[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) {
    yield Buffer.from(chunk);
  }
}

async function collect(
  gen: AsyncIterable<OrchestratorYield>
): Promise<OrchestratorYield[]> {
  const items: OrchestratorYield[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

describe('ConversationOrchestrator streaming STT', () => {
  let llm: StreamingLLMStub;
  let stt: StreamingSTTStub;
  let tts: TTSStub;
  let orchestrator: ConversationOrchestrator;

  beforeEach(() => {
    llm = new StreamingLLMStub();
    stt = new StreamingSTTStub();
    tts = new TTSStub();
    orchestrator = new ConversationOrchestrator({
      providers: { llm, stt, tts },
      streamingTTS: false
    });
  });

  it('yields interim transcripts before the LLM response', async () => {
    stt.results = [
      { text: 'hel', isFinal: false },
      { text: 'hello wor', isFinal: false },
      { text: 'hello world', isFinal: true }
    ];

    const items = await collect(
      orchestrator.runTurnStreamFromAudioStream(frames('a', 'b'))
    );

    const transcripts = items.filter(
      (i): i is STTResult => 'isFinal' in i && 'text' in i
    );
    expect(transcripts.map((t) => [t.text, t.isFinal])).toEqual([
      ['hel', false],
      ['hello wor', false],
      ['hello world', true]
    ]);
    // Interims come before any LLM output
    const firstLLMIndex = items.findIndex((i) => 'done' in i && 'content' in i);
    const lastTranscriptIndex = items.reduce(
      (last, item, idx) => ('isFinal' in item ? idx : last),
      -1
    );
    expect(firstLLMIndex).toBeGreaterThan(lastTranscriptIndex);
  });

  it('drives the LLM with the final transcript text', async () => {
    stt.results = [
      { text: 'partial', isFinal: false },
      { text: 'what is the weather', isFinal: true }
    ];

    await collect(orchestrator.runTurnStreamFromAudioStream(frames('x')));

    expect(llm.requests).toHaveLength(1);
    const userMessage = llm.requests[0].messages.findLast((m) => m.role === 'user');
    expect(userMessage?.content).toBe('what is the weather');
  });

  it('concatenates multiple final segments into one transcript', async () => {
    stt.results = [
      { text: 'first segment.', isFinal: true },
      { text: 'second segment.', isFinal: true }
    ];

    await collect(orchestrator.runTurnStreamFromAudioStream(frames('x')));

    const userMessage = llm.requests[0].messages.findLast((m) => m.role === 'user');
    expect(userMessage?.content).toBe('first segment. second segment.');
  });

  it('passes the audio frames through to the provider', async () => {
    stt.results = [{ text: 'ok', isFinal: true }];

    await collect(
      orchestrator.runTurnStreamFromAudioStream(frames('frame-1', 'frame-2', 'frame-3'))
    );

    expect(stt.receivedFrames.map((f) => f.toString())).toEqual([
      'frame-1',
      'frame-2',
      'frame-3'
    ]);
  });

  it('skips the LLM turn when no speech was recognized', async () => {
    stt.results = [{ text: '  ', isFinal: false }];

    const items = await collect(orchestrator.runTurnStreamFromAudioStream(frames('x')));

    expect(llm.requests).toHaveLength(0);
    expect(tts.speakCalls).toHaveLength(0);
    // Only the interim yield, nothing else
    expect(items).toHaveLength(1);
  });

  it('throws a clear error when the provider cannot stream', async () => {
    const bufferedOrchestrator = new ConversationOrchestrator({
      providers: { llm, stt: new BufferedOnlySTT(), tts },
      streamingTTS: false
    });

    await expect(
      collect(bufferedOrchestrator.runTurnStreamFromAudioStream(frames('x')))
    ).rejects.toThrow(/does not support transcribeStream/);
  });

  it('stops after STT when the turn is aborted mid-stream', async () => {
    stt.results = [
      { text: 'partial', isFinal: false },
      { text: 'full text', isFinal: true }
    ];
    const controller = new AbortController();
    const items: OrchestratorYield[] = [];

    for await (const item of orchestrator.runTurnStreamFromAudioStream(
      frames('x'),
      [],
      { signal: controller.signal }
    )) {
      items.push(item);
      controller.abort();
    }

    // First yield observed, then the abort stops the turn before the LLM
    expect(items).toHaveLength(1);
    expect(llm.requests).toHaveLength(0);
  });

  it('leaves the buffered runTurnStream path unchanged', async () => {
    const items = await collect(orchestrator.runTurnStream(Buffer.from('wav')));

    const transcripts = items.filter((i): i is STTResult => 'isFinal' in i);
    expect(transcripts).toEqual([{ text: 'buffered path', isFinal: true }]);
    const userMessage = llm.requests[0].messages.findLast((m) => m.role === 'user');
    expect(userMessage?.content).toBe('buffered path');
  });
});
