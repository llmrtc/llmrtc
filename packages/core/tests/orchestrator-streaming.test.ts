import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationOrchestrator,
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMChunk,
  OrchestratorYield,
  TTSChunk,
  TTSStart,
  TTSComplete,
  LLMResult,
  STTResult
} from '../src/index.js';

/**
 * Streaming LLM stub that yields chunks character by character
 * or by custom chunk sizes for testing sentence boundary detection.
 */
class StreamingLLMStub implements LLMProvider {
  name = 'streaming-llm-stub';
  response = '';
  chunkSize = 1;

  setResponse(text: string, chunkSize = 1) {
    this.response = text;
    this.chunkSize = chunkSize;
  }

  async complete(req: LLMRequest) {
    return { fullText: this.response };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    for (let i = 0; i < this.response.length; i += this.chunkSize) {
      const content = this.response.slice(i, i + this.chunkSize);
      yield { content, done: false };
    }
    yield { content: '', done: true };
  }
}

class StubSTT implements STTProvider {
  name = 'stub-stt';
  transcription = 'test input';

  async transcribe(_audio: Buffer): Promise<STTResult> {
    return { text: this.transcription, isFinal: true };
  }
}

/**
 * Streaming TTS stub that tracks speak calls and can simulate streaming.
 */
class StreamingTTSStub implements TTSProvider {
  name = 'streaming-tts-stub';
  speakCalls: string[] = [];
  streamCalls: string[] = [];

  async speak(text: string) {
    this.speakCalls.push(text);
    return { audio: Buffer.from(`audio:${text}`), format: 'mp3' as const };
  }

  async *speakStream(text: string, config?: { format?: string }): AsyncIterable<Buffer> {
    this.streamCalls.push(text);
    // Simulate streaming by yielding chunks
    yield Buffer.from(`chunk1:${text.slice(0, 10)}`);
    yield Buffer.from(`chunk2:${text.slice(10)}`);
  }
}

describe('ConversationOrchestrator Streaming', () => {
  let llm: StreamingLLMStub;
  let stt: StubSTT;
  let tts: StreamingTTSStub;

  beforeEach(() => {
    llm = new StreamingLLMStub();
    stt = new StubSTT();
    tts = new StreamingTTSStub();
  });

  describe('runTurnStream', () => {
    it('should handle single sentence response', async () => {
      llm.setResponse('Hello, world!');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      // Should have: STT result, LLM chunks, LLM result, TTS start, TTS chunks, TTS complete
      const sttResults = yields.filter((y): y is STTResult => 'text' in y && 'isFinal' in y);
      const llmChunks = yields.filter((y): y is LLMChunk => 'content' in y && 'done' in y);
      const llmResults = yields.filter((y): y is LLMResult => 'fullText' in y);
      const ttsStarts = yields.filter((y): y is TTSStart => (y as TTSStart).type === 'tts-start');
      const ttsChunks = yields.filter((y): y is TTSChunk => (y as TTSChunk).type === 'tts-chunk');
      const ttsCompletes = yields.filter((y): y is TTSComplete => (y as TTSComplete).type === 'tts-complete');

      expect(sttResults).toHaveLength(1);
      expect(sttResults[0].text).toBe('test input');

      expect(llmChunks.length).toBeGreaterThan(0);
      expect(llmResults).toHaveLength(1);
      expect(llmResults[0].fullText).toBe('Hello, world!');

      expect(ttsStarts).toHaveLength(1);
      expect(ttsCompletes).toHaveLength(1);
      expect(ttsChunks.length).toBeGreaterThan(0);
    });

    it('should handle multi-sentence response with sentence-by-sentence TTS', async () => {
      // Three sentences
      llm.setResponse('First sentence. Second sentence. Third sentence.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      // TTS should be called for each sentence as it completes
      // The exact number depends on sentence boundary detection
      expect(tts.streamCalls.length).toBeGreaterThanOrEqual(1);

      // Verify all sentences were processed
      const allText = tts.streamCalls.join(' ');
      expect(allText).toContain('First');
      expect(allText).toContain('Second');
      expect(allText).toContain('Third');
    });

    it('should handle text without sentence-ending punctuation', async () => {
      // No period at end - should still be spoken
      llm.setResponse('This is a response without ending punctuation');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      // Should still generate TTS for the text
      expect(tts.streamCalls.length).toBeGreaterThanOrEqual(1);
      const allText = tts.streamCalls.join(' ');
      expect(allText).toContain('without ending punctuation');
    });

    it('should handle trailing punctuation edge cases', async () => {
      // Multiple punctuation marks and ellipsis
      llm.setResponse('Wait... Really? Yes!');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsChunks = yields.filter((y): y is TTSChunk => (y as TTSChunk).type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);

      // Should have processed all text
      const llmResults = yields.filter((y): y is LLMResult => 'fullText' in y);
      expect(llmResults[0].fullText).toBe('Wait... Really? Yes!');
    });

    it('should fall back to non-streaming TTS when streamingTTS is false', async () => {
      llm.setResponse('Hello, world!');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: false
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      // Should use speak() not speakStream()
      expect(tts.speakCalls.length).toBeGreaterThanOrEqual(1);
      expect(tts.streamCalls.length).toBe(0);
    });
  });

  describe('TTS chunk metadata', () => {
    it('should include format in TTS chunks', async () => {
      llm.setResponse('Hello.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsChunks = yields.filter((y): y is TTSChunk => (y as TTSChunk).type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);

      for (const chunk of ttsChunks) {
        expect(chunk.format).toBe('pcm');
      }
    });

    it('should include sampleRate in TTS chunks', async () => {
      llm.setResponse('Hello.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsChunks = yields.filter((y): y is TTSChunk => (y as TTSChunk).type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);

      for (const chunk of ttsChunks) {
        expect(chunk.sampleRate).toBe(24000);
      }
    });

    it('should include sentence text in TTS chunks', async () => {
      llm.setResponse('Hello.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsChunks = yields.filter((y): y is TTSChunk => (y as TTSChunk).type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);

      // All chunks for the same sentence should have the sentence text
      for (const chunk of ttsChunks) {
        expect(chunk.sentence).toBeDefined();
        expect(typeof chunk.sentence).toBe('string');
      }
    });

    it('should yield tts-start before any tts-chunk', async () => {
      llm.setResponse('First. Second.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsStartIndex = yields.findIndex((y) => (y as TTSStart).type === 'tts-start');
      const firstChunkIndex = yields.findIndex((y) => (y as TTSChunk).type === 'tts-chunk');

      expect(ttsStartIndex).toBeGreaterThan(-1);
      expect(firstChunkIndex).toBeGreaterThan(-1);
      expect(ttsStartIndex).toBeLessThan(firstChunkIndex);
    });

    it('should yield tts-complete after all tts-chunks', async () => {
      llm.setResponse('Test sentence.');

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true
      });

      const yields: OrchestratorYield[] = [];
      for await (const item of orchestrator.runTurnStream(Buffer.from('audio'))) {
        yields.push(item);
      }

      const ttsCompleteIndex = yields.findIndex((y) => (y as TTSComplete).type === 'tts-complete');
      const lastChunkIndex = yields.map((y, i) => (y as TTSChunk).type === 'tts-chunk' ? i : -1)
        .filter(i => i !== -1)
        .pop() ?? -1;

      expect(ttsCompleteIndex).toBeGreaterThan(-1);
      expect(lastChunkIndex).toBeGreaterThan(-1);
      expect(ttsCompleteIndex).toBeGreaterThan(lastChunkIndex);
    });
  });
});
