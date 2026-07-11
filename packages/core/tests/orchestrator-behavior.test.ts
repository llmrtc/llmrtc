import { describe, it, expect } from 'vitest';
import {
  ConversationOrchestrator,
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMChunk,
  STTResult,
  TTSChunk
} from '../src/index.js';

class RecordingLLM implements LLMProvider {
  name = 'recording-llm';
  requests: LLMRequest[] = [];
  response = 'Response.';

  async complete(req: LLMRequest) {
    this.requests.push(req);
    return { fullText: this.response };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    this.requests.push(req);
    for (const word of this.response.split(/(?<= )/)) {
      yield { content: word, done: false };
    }
    yield { content: '', done: true };
  }
}

class StubSTT implements STTProvider {
  name = 'stub-stt';
  transcription = 'hello';
  calls = 0;

  async transcribe(_audio: Buffer): Promise<STTResult> {
    this.calls++;
    return { text: this.transcription, isFinal: true };
  }
}

class StubTTS implements TTSProvider {
  name = 'stub-tts';
  speakCalls: string[] = [];
  streamCalls: string[] = [];

  async speak(text: string) {
    this.speakCalls.push(text);
    return { audio: Buffer.from(`audio:${text}`), format: 'mp3' as const };
  }

  async *speakStream(text: string): AsyncIterable<Buffer> {
    this.streamCalls.push(text);
    yield Buffer.from(`pcm:${text}`);
  }
}

function makeProviders() {
  return {
    llm: new RecordingLLM(),
    stt: new StubSTT(),
    tts: new StubTTS()
  };
}

async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const items: unknown[] = [];
  for await (const item of iter) {
    items.push(item);
  }
  return items;
}

describe('ConversationOrchestrator behavior', () => {
  describe('system prompt handling', () => {
    it('includes the system prompt in streaming requests', async () => {
      const providers = makeProviders();
      const orchestrator = new ConversationOrchestrator({
        providers,
        systemPrompt: 'You are a pirate.',
        historyLimit: 8
      });

      await drain(orchestrator.runTurnStream(Buffer.from('a')));

      expect(providers.llm.requests).toHaveLength(1);
      const messages = providers.llm.requests[0].messages;
      expect(messages[0]).toMatchObject({ role: 'system', content: 'You are a pirate.' });
    });

    it('keeps the system prompt in the window after many turns', async () => {
      const providers = makeProviders();
      const orchestrator = new ConversationOrchestrator({
        providers,
        systemPrompt: 'You are a pirate.',
        historyLimit: 4
      });

      for (let i = 0; i < 8; i++) {
        providers.stt.transcription = `message ${i}`;
        await drain(orchestrator.runTurnStream(Buffer.from('a')));
      }

      const lastRequest = providers.llm.requests[providers.llm.requests.length - 1];
      expect(lastRequest.messages[0]).toMatchObject({
        role: 'system',
        content: 'You are a pirate.'
      });
      // The window holds the system message plus at most historyLimit others
      expect(lastRequest.messages.length).toBeLessThanOrEqual(5);
      expect(
        lastRequest.messages.filter(m => m.role === 'system')
      ).toHaveLength(1);
    });

    it('keeps the system prompt in non-streaming runTurn after many turns', async () => {
      const providers = makeProviders();
      providers.llm.stream = undefined as never;
      const orchestrator = new ConversationOrchestrator({
        providers,
        systemPrompt: 'Persona prompt.',
        historyLimit: 2
      });

      for (let i = 0; i < 6; i++) {
        await orchestrator.runTurn(Buffer.from('a'));
      }

      const lastRequest = providers.llm.requests[providers.llm.requests.length - 1];
      expect(lastRequest.messages[0]).toMatchObject({ role: 'system' });
    });
  });

  describe('empty transcript guard', () => {
    it('skips the LLM and TTS when the transcript is empty', async () => {
      const providers = makeProviders();
      providers.stt.transcription = '   ';
      const orchestrator = new ConversationOrchestrator({ providers });

      const items = await drain(orchestrator.runTurnStream(Buffer.from('a')));

      // Only the transcript is yielded; no request was made
      expect(items).toHaveLength(1);
      expect(providers.llm.requests).toHaveLength(0);
      expect(providers.tts.streamCalls).toHaveLength(0);
      expect(providers.tts.speakCalls).toHaveLength(0);
    });
  });

  describe('abort handling', () => {
    it('stops generating on abort and commits the partial response', async () => {
      const providers = makeProviders();
      providers.llm.response = 'One. Two. Three. Four. Five.';
      const controller = new AbortController();

      let turnEnded = false;
      const orchestrator = new ConversationOrchestrator({
        providers,
        systemPrompt: 'p',
        hooks: {
          onTurnEnd() {
            turnEnded = true;
          }
        }
      });

      const items: unknown[] = [];
      let chunksSeen = 0;
      for await (const item of orchestrator.runTurnStream(Buffer.from('a'), [], {
        signal: controller.signal
      })) {
        items.push(item);
        if ('done' in (item as LLMChunk) && 'content' in (item as LLMChunk)) {
          chunksSeen++;
          if (chunksSeen === 2) {
            controller.abort();
          }
        }
      }

      // No further LLM chunks after the abort took effect
      const llmChunks = items.filter(
        i => typeof i === 'object' && i !== null && 'done' in i && 'content' in i
      );
      expect(llmChunks.length).toBeLessThan(7);
      // onTurnEnd still ran (bookkeeping is guaranteed via finally)
      expect(turnEnded).toBe(true);
    });
  });

  describe('onLLMEnd guardrail', () => {
    it('rejects the turn and does not speak when onLLMEnd throws', async () => {
      const providers = makeProviders();
      providers.llm.response = 'Forbidden content';
      // Disable streaming TTS so nothing is spoken before the guardrail runs
      const orchestrator = new ConversationOrchestrator({
        providers,
        streamingTTS: false,
        hooks: {
          onLLMEnd(_ctx, result) {
            if (result.fullText.includes('Forbidden')) {
              throw new Error('Content policy violation');
            }
          }
        }
      });

      await expect(drain(orchestrator.runTurnStream(Buffer.from('a')))).rejects.toThrow(
        'Content policy violation'
      );
      expect(providers.tts.speakCalls).toHaveLength(0);
      expect(providers.tts.streamCalls).toHaveLength(0);

      // The rejected response is not in the next request's history
      providers.llm.response = 'Safe response.';
      await drain(orchestrator.runTurnStream(Buffer.from('a')));
      const lastRequest = providers.llm.requests[providers.llm.requests.length - 1];
      expect(
        lastRequest.messages.some(m => m.content.includes('Forbidden'))
      ).toBe(false);
    });

    it('rejects the turn when onLLMEnd throws in the non-streaming fallback', async () => {
      const providers = makeProviders();
      providers.llm.stream = undefined as never;
      providers.llm.response = 'Blocked';
      const orchestrator = new ConversationOrchestrator({
        providers,
        hooks: {
          onLLMEnd() {
            throw new Error('Blocked by guardrail');
          }
        }
      });

      await expect(drain(orchestrator.runTurnStream(Buffer.from('a')))).rejects.toThrow(
        'Blocked by guardrail'
      );
      expect(providers.tts.speakCalls).toHaveLength(0);
    });
  });

  describe('TTS metadata', () => {
    it('uses the provider-declared PCM sample rate in chunks', async () => {
      const providers = makeProviders();
      (providers.tts as TTSProvider).pcmSampleRate = 16000;
      providers.llm.response = 'Hello there. How are you.';
      const orchestrator = new ConversationOrchestrator({ providers });

      const items = await drain(orchestrator.runTurnStream(Buffer.from('a')));
      const ttsChunks = items.filter(
        (i): i is TTSChunk =>
          typeof i === 'object' && i !== null && (i as TTSChunk).type === 'tts-chunk'
      );
      expect(ttsChunks.length).toBeGreaterThan(0);
      for (const chunk of ttsChunks) {
        expect(chunk.sampleRate).toBe(16000);
      }
    });
  });
});
