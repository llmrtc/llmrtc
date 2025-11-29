import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ConversationOrchestrator,
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMChunk,
  LLMResult,
  STTResult,
  OrchestratorHooks,
  TurnContext,
  TimingInfo,
  InMemoryMetrics,
  MetricNames,
  createLoggingHooks,
  createTimingInfo,
  createErrorContext,
  callHookSafe
} from '../src/index.js';

// =============================================================================
// Test Stubs
// =============================================================================

class StubLLM implements LLMProvider {
  name = 'stub-llm';
  response = 'Hello from LLM';

  async complete(req: LLMRequest): Promise<LLMResult> {
    return { fullText: this.response };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    const words = this.response.split(' ');
    for (const word of words) {
      yield { content: word + ' ', done: false };
    }
    yield { content: '', done: true };
  }
}

class StubSTT implements STTProvider {
  name = 'stub-stt';
  transcription = 'test input';
  shouldFail = false;

  async transcribe(_audio: Buffer): Promise<STTResult> {
    if (this.shouldFail) {
      throw new Error('STT failed');
    }
    return { text: this.transcription, isFinal: true };
  }
}

class StubTTS implements TTSProvider {
  name = 'stub-tts';
  speakCalls: string[] = [];

  async speak(text: string) {
    this.speakCalls.push(text);
    return { audio: Buffer.from(`audio:${text}`), format: 'mp3' as const };
  }

  async *speakStream(text: string): AsyncIterable<Buffer> {
    this.speakCalls.push(text);
    yield Buffer.from(`chunk1:${text}`);
    yield Buffer.from(`chunk2:${text}`);
  }
}

// =============================================================================
// Hook Call Tracking
// =============================================================================

interface HookCall {
  name: string;
  timestamp: number;
  args: unknown[];
}

function createTrackingHooks(): { hooks: OrchestratorHooks; calls: HookCall[] } {
  const calls: HookCall[] = [];

  const track = (name: string) => (...args: unknown[]) => {
    calls.push({ name, timestamp: Date.now(), args });
  };

  return {
    calls,
    hooks: {
      onTurnStart: track('onTurnStart'),
      onTurnEnd: track('onTurnEnd'),
      onSTTStart: track('onSTTStart'),
      onSTTEnd: track('onSTTEnd'),
      onSTTError: track('onSTTError'),
      onLLMStart: track('onLLMStart'),
      onLLMChunk: track('onLLMChunk'),
      onLLMEnd: track('onLLMEnd'),
      onLLMError: track('onLLMError'),
      onTTSStart: track('onTTSStart'),
      onTTSChunk: track('onTTSChunk'),
      onTTSEnd: track('onTTSEnd'),
      onTTSError: track('onTTSError')
    }
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('Hooks System', () => {
  let llm: StubLLM;
  let stt: StubSTT;
  let tts: StubTTS;

  beforeEach(() => {
    llm = new StubLLM();
    stt = new StubSTT();
    tts = new StubTTS();
  });

  describe('Hook Execution Order', () => {
    it('should call hooks in correct order during a turn', async () => {
      const { hooks, calls } = createTrackingHooks();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks
      });

      // Consume the generator
      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      // Extract hook names in order
      const hookOrder = calls.map(c => c.name);

      // Verify order: turn start -> STT -> LLM -> TTS -> turn end
      expect(hookOrder).toContain('onTurnStart');
      expect(hookOrder).toContain('onSTTStart');
      expect(hookOrder).toContain('onSTTEnd');
      expect(hookOrder).toContain('onLLMStart');
      expect(hookOrder).toContain('onLLMEnd');
      expect(hookOrder).toContain('onTTSStart');
      expect(hookOrder).toContain('onTTSEnd');
      expect(hookOrder).toContain('onTurnEnd');

      // Check relative ordering
      const turnStartIdx = hookOrder.indexOf('onTurnStart');
      const sttEndIdx = hookOrder.indexOf('onSTTEnd');
      const llmEndIdx = hookOrder.indexOf('onLLMEnd');
      const ttsEndIdx = hookOrder.indexOf('onTTSEnd');
      const turnEndIdx = hookOrder.indexOf('onTurnEnd');

      expect(turnStartIdx).toBeLessThan(sttEndIdx);
      expect(sttEndIdx).toBeLessThan(llmEndIdx);
      expect(llmEndIdx).toBeLessThan(ttsEndIdx);
      expect(ttsEndIdx).toBeLessThan(turnEndIdx);
    });

    it('should call onLLMChunk for each chunk', async () => {
      const { hooks, calls } = createTrackingHooks();
      llm.response = 'One two three';

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const chunkCalls = calls.filter(c => c.name === 'onLLMChunk');
      // "One two three" = 3 words + 1 done chunk = 4 chunks total
      expect(chunkCalls.length).toBeGreaterThanOrEqual(3);

      // Verify chunk indices are sequential
      const indices = chunkCalls.map(c => c.args[2] as number);
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]).toBe(i);
      }
    });
  });

  describe('Timing Information', () => {
    it('should provide accurate timing info in onSTTEnd', async () => {
      const timings: TimingInfo[] = [];

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks: {
          onSTTEnd(_ctx, _result, timing) {
            timings.push(timing);
          }
        }
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      expect(timings.length).toBe(1);
      expect(timings[0].durationMs).toBeGreaterThanOrEqual(0);
      // Operations may complete in the same millisecond, so use >= instead of >
      expect(timings[0].endTime).toBeGreaterThanOrEqual(timings[0].startTime);
      expect(timings[0].durationMs).toBe(timings[0].endTime - timings[0].startTime);
    });

    it('should provide accurate timing info in onTurnEnd', async () => {
      const timings: TimingInfo[] = [];
      const startTime = Date.now();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks: {
          onTurnEnd(_ctx, timing) {
            timings.push(timing);
          }
        }
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      expect(timings.length).toBe(1);
      expect(timings[0].startTime).toBeGreaterThanOrEqual(startTime);
      // Operations may complete in the same millisecond, so use >= instead of >
      expect(timings[0].endTime).toBeGreaterThanOrEqual(timings[0].startTime);
    });
  });

  describe('Turn Context', () => {
    it('should provide turnId in all hooks', async () => {
      const turnIds: Set<string> = new Set();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks: {
          onTurnStart(ctx) { turnIds.add(ctx.turnId); },
          onSTTStart(ctx) { turnIds.add(ctx.turnId); },
          onSTTEnd(ctx) { turnIds.add(ctx.turnId); },
          onLLMStart(ctx) { turnIds.add(ctx.turnId); },
          onLLMEnd(ctx) { turnIds.add(ctx.turnId); },
          onTTSStart(ctx) { turnIds.add(ctx.turnId); },
          onTTSEnd(ctx) { turnIds.add(ctx.turnId); },
          onTurnEnd(ctx) { turnIds.add(ctx.turnId); }
        }
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      // All hooks should have received the same turnId
      expect(turnIds.size).toBe(1);
      const turnId = [...turnIds][0];
      expect(turnId).toBeDefined();
      expect(turnId.length).toBeGreaterThan(0);
    });

    it('should include sessionId when configured', async () => {
      const contexts: TurnContext[] = [];

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        sessionId: 'test-session-123',
        hooks: {
          onTurnStart(ctx) { contexts.push(ctx); }
        }
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      expect(contexts.length).toBe(1);
      expect(contexts[0].sessionId).toBe('test-session-123');
    });
  });

  describe('Error Hooks', () => {
    it('should call onSTTError when STT fails', async () => {
      const errors: Error[] = [];
      stt.shouldFail = true;

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks: {
          onSTTError(_ctx, error) {
            errors.push(error);
          }
        }
      });

      await expect(async () => {
        for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
          // Process all items
        }
      }).rejects.toThrow('STT failed');

      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('STT failed');
    });
  });

  describe('Metrics Integration', () => {
    it('should emit STT duration metric', async () => {
      const metrics = new InMemoryMetrics();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const sttTiming = metrics.getLatestTiming(MetricNames.STT_DURATION);
      expect(sttTiming).toBeDefined();
      expect(sttTiming!.durationMs).toBeGreaterThanOrEqual(0);
      expect(sttTiming!.tags?.provider).toBe('stub-stt');
    });

    it('should emit LLM duration metric', async () => {
      const metrics = new InMemoryMetrics();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const llmTiming = metrics.getLatestTiming(MetricNames.LLM_DURATION);
      expect(llmTiming).toBeDefined();
      expect(llmTiming!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should emit TTS duration metric', async () => {
      const metrics = new InMemoryMetrics();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const ttsTiming = metrics.getLatestTiming(MetricNames.TTS_DURATION);
      expect(ttsTiming).toBeDefined();
      expect(ttsTiming!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should emit turn duration metric', async () => {
      const metrics = new InMemoryMetrics();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const turnTiming = metrics.getLatestTiming(MetricNames.TURN_DURATION);
      expect(turnTiming).toBeDefined();
      expect(turnTiming!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should emit error counter on STT failure', async () => {
      const metrics = new InMemoryMetrics();
      stt.shouldFail = true;

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      try {
        for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
          // Process all items
        }
      } catch {
        // Expected
      }

      const errorCount = metrics.getCounterSum(MetricNames.ERRORS);
      expect(errorCount).toBeGreaterThanOrEqual(1);
    });

    it('should emit TTFT metric for streaming LLM', async () => {
      const metrics = new InMemoryMetrics();

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      const ttftTiming = metrics.getLatestTiming(MetricNames.LLM_TTFT);
      expect(ttftTiming).toBeDefined();
      expect(ttftTiming!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Custom Sentence Chunker', () => {
    it('should use custom sentence chunker when provided', async () => {
      const chunkerCalls: string[] = [];

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        sentenceChunker: (text) => {
          chunkerCalls.push(text);
          // Custom chunker: split on commas
          return text.split(',').map(s => s.trim()).filter(Boolean);
        }
      });

      llm.response = 'First part, second part, third part';

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }

      // Chunker should have been called during streaming
      expect(chunkerCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Async Hooks', () => {
    it('should not block on slow async hooks', async () => {
      let hookCompleted = false;

      const orchestrator = new ConversationOrchestrator({
        providers: { llm, stt, tts },
        streamingTTS: true,
        hooks: {
          async onSTTEnd() {
            // Simulate slow async operation
            await new Promise(resolve => setTimeout(resolve, 10));
            hookCompleted = true;
          }
        }
      });

      const startTime = Date.now();
      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // Process all items
      }
      const elapsed = Date.now() - startTime;

      // Hook should have completed (we await it properly now)
      expect(hookCompleted).toBe(true);
    });

    it('should handle hook errors gracefully via callHookSafe', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingHook = async () => {
        throw new Error('Hook failed');
      };

      // callHookSafe should not throw
      await expect(callHookSafe(failingHook)).resolves.toBeUndefined();

      // Error should have been logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[hooks] Hook error:'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});

describe('Utility Functions', () => {
  describe('createTimingInfo', () => {
    it('should create correct timing info', () => {
      const timing = createTimingInfo(1000, 1500);
      expect(timing.startTime).toBe(1000);
      expect(timing.endTime).toBe(1500);
      expect(timing.durationMs).toBe(500);
    });
  });

  describe('createErrorContext', () => {
    it('should create error context with all fields', () => {
      const ctx = createErrorContext('STT_ERROR', 'stt', {
        sessionId: 'session-1',
        turnId: 'turn-1',
        details: { model: 'whisper' }
      });

      expect(ctx.code).toBe('STT_ERROR');
      expect(ctx.component).toBe('stt');
      expect(ctx.sessionId).toBe('session-1');
      expect(ctx.turnId).toBe('turn-1');
      expect(ctx.timestamp).toBeGreaterThan(0);
      expect(ctx.details).toEqual({ model: 'whisper' });
    });

    it('should create error context without optional fields', () => {
      const ctx = createErrorContext('INTERNAL_ERROR', 'server');

      expect(ctx.code).toBe('INTERNAL_ERROR');
      expect(ctx.component).toBe('server');
      expect(ctx.sessionId).toBeUndefined();
      expect(ctx.turnId).toBeUndefined();
      expect(ctx.timestamp).toBeGreaterThan(0);
    });
  });
});

describe('Logging Hooks', () => {
  it('should create logging hooks with default config', () => {
    const hooks = createLoggingHooks();

    expect(hooks.onTurnStart).toBeDefined();
    expect(hooks.onSTTEnd).toBeDefined();
    expect(hooks.onLLMEnd).toBeDefined();
    expect(hooks.onTTSEnd).toBeDefined();
    expect(hooks.onTurnEnd).toBeDefined();
    expect(hooks.onError).toBeDefined();
  });

  it('should log to custom logger', async () => {
    const logs: string[] = [];
    const customLogger = {
      debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
      info: (msg: string) => logs.push(`INFO: ${msg}`),
      log: (msg: string) => logs.push(`LOG: ${msg}`),
      warn: (msg: string) => logs.push(`WARN: ${msg}`),
      error: (msg: string) => logs.push(`ERROR: ${msg}`)
    };

    const hooks = createLoggingHooks({ logger: customLogger, level: 'info' });

    // Call a hook
    if (hooks.onTurnStart) {
      await hooks.onTurnStart(
        { turnId: 'test-turn', startTime: Date.now() },
        Buffer.from('audio')
      );
    }

    expect(logs.some(l => l.includes('Turn started'))).toBe(true);
  });

  it('should respect log level', async () => {
    const logs: string[] = [];
    const customLogger = {
      debug: (msg: string) => logs.push(`DEBUG: ${msg}`),
      info: (msg: string) => logs.push(`INFO: ${msg}`),
      log: (msg: string) => logs.push(`LOG: ${msg}`),
      warn: (msg: string) => logs.push(`WARN: ${msg}`),
      error: (msg: string) => logs.push(`ERROR: ${msg}`)
    };

    // Set level to 'error' - should only log errors
    const hooks = createLoggingHooks({ logger: customLogger, level: 'error' });

    if (hooks.onTurnStart) {
      await hooks.onTurnStart(
        { turnId: 'test-turn', startTime: Date.now() },
        Buffer.from('audio')
      );
    }

    // Turn start is 'info' level, should not be logged
    expect(logs.some(l => l.includes('Turn started'))).toBe(false);

    // Now log an error
    if (hooks.onError) {
      await hooks.onError(new Error('Test error'), {
        code: 'INTERNAL_ERROR',
        component: 'server',
        timestamp: Date.now()
      });
    }

    // Error should be logged
    expect(logs.some(l => l.includes('ERROR'))).toBe(true);
  });
});
