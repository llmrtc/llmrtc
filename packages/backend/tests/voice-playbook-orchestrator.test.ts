import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoicePlaybookOrchestrator } from '../src/voice-playbook-orchestrator.js';
import type { TurnOrchestratorYield, ToolCallStartEvent, ToolCallEndEvent, StageChangeEvent } from '../src/turn-orchestrator.js';
import type {
  LLMProvider,
  STTProvider,
  TTSProvider,
  LLMRequest,
  LLMResult,
  LLMChunk,
  Playbook,
  OrchestratorHooks,
  MetricsAdapter
} from '@metered/llmrtc-core';
import { ToolRegistry } from '@metered/llmrtc-core';

// =============================================================================
// Mock Providers
// =============================================================================

function createMockSTTProvider(transcription: string = 'hello world'): STTProvider {
  return {
    name: 'mock-stt',
    init: vi.fn().mockResolvedValue(undefined),
    async transcribe(_audio: Buffer) {
      return { text: transcription, isFinal: true };
    }
  };
}

function createMockLLMProvider(responses: LLMResult[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock-llm',
    init: vi.fn().mockResolvedValue(undefined),
    async complete(request: LLMRequest): Promise<LLMResult> {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    },
    async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
      const result = await this.complete(request);
      yield { content: result.fullText, done: false };
      yield { content: '', done: true, stopReason: result.stopReason };
    }
  };
}

function createMockTTSProvider(streamable = true): TTSProvider {
  const provider: TTSProvider = {
    name: 'mock-tts',
    init: vi.fn().mockResolvedValue(undefined),
    async speak(text: string) {
      return { audio: Buffer.from(`tts:${text}`), format: 'mp3' as const };
    }
  };

  if (streamable) {
    provider.speakStream = async function* (text: string) {
      yield Buffer.from(`tts-chunk:${text}`);
    };
  }

  return provider;
}

// =============================================================================
// Test Playbook
// =============================================================================

function createTestPlaybook(): Playbook {
  return {
    id: 'test-playbook',
    name: 'Test Playbook',
    stages: [
      {
        id: 'greeting',
        name: 'Greeting Stage',
        systemPrompt: 'You are greeting the user.',
        description: 'Initial greeting phase'
      },
      {
        id: 'main',
        name: 'Main Stage',
        systemPrompt: 'You are helping the user with their request.',
        description: 'Main conversation phase'
      },
      {
        id: 'farewell',
        name: 'Farewell Stage',
        systemPrompt: 'You are saying goodbye to the user.',
        description: 'Closing phase'
      }
    ],
    transitions: [
      {
        id: 'greeting-to-main',
        from: 'greeting',
        condition: { type: 'keyword', keywords: ['help', 'assist'] },
        action: { targetStage: 'main' }
      },
      {
        id: 'main-to-farewell',
        from: 'main',
        condition: { type: 'keyword', keywords: ['bye', 'goodbye'] },
        action: { targetStage: 'farewell' }
      },
      {
        id: 'llm-transition',
        from: '*',
        condition: { type: 'llm_decision' },
        action: { targetStage: 'farewell' }
      }
    ],
    initialStage: 'greeting',
    globalSystemPrompt: 'You are a helpful assistant.'
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('VoicePlaybookOrchestrator', () => {
  let sttProvider: STTProvider;
  let llmProvider: LLMProvider;
  let ttsProvider: TTSProvider;
  let toolRegistry: ToolRegistry;
  let playbook: Playbook;

  beforeEach(() => {
    sttProvider = createMockSTTProvider();
    llmProvider = createMockLLMProvider([
      { fullText: 'Hello there! How can I help you?', stopReason: 'end_turn' }
    ]);
    ttsProvider = createMockTTSProvider();
    toolRegistry = new ToolRegistry();
    playbook = createTestPlaybook();
  });

  describe('Initialization', () => {
    it('should create orchestrator with correct configuration', () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      expect(orchestrator).toBeDefined();
      expect(orchestrator.getPlaybookOrchestrator()).toBeDefined();
      expect(orchestrator.getPlaybookOrchestrator().getEngine().getCurrentStage().id).toBe('greeting');
    });

    it('should initialize all providers', async () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      await orchestrator.init();

      expect(llmProvider.init).toHaveBeenCalled();
      expect(sttProvider.init).toHaveBeenCalled();
      expect(ttsProvider.init).toHaveBeenCalled();
    });
  });

  describe('runTurnStream - Basic Flow', () => {
    it('should yield transcript first', async () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      // First event should be the transcript
      expect(events[0]).toEqual({ text: 'hello world', isFinal: true });
    });

    it('should yield LLM result', async () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      // Should have LLM result
      const llmResult = events.find(e => 'fullText' in e && typeof e.fullText === 'string');
      expect(llmResult).toBeDefined();
      expect((llmResult as LLMResult).fullText).toBe('Hello there! How can I help you?');
    });

    it('should yield TTS start and complete events', async () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        streamingTTS: true
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const ttsStart = events.find(e => 'type' in e && e.type === 'tts-start');
      const ttsComplete = events.find(e => 'type' in e && e.type === 'tts-complete');

      expect(ttsStart).toBeDefined();
      expect(ttsComplete).toBeDefined();
    });

    it('should yield TTS chunks for streaming TTS', async () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        streamingTTS: true
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const ttsChunks = events.filter(e => 'type' in e && e.type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);
    });

    it('should use non-streaming TTS when streamingTTS is false', async () => {
      const nonStreamingTTS = createMockTTSProvider(false);
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: nonStreamingTTS },
        playbook,
        toolRegistry,
        streamingTTS: false
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      // Should have TTSResult instead of tts-chunk
      const ttsResult = events.find(e => 'audio' in e && 'format' in e);
      expect(ttsResult).toBeDefined();
    });
  });

  describe('Tool Call Events', () => {
    it('should yield tool-call-start and tool-call-end events', async () => {
      // Register a test tool
      toolRegistry.register({
        definition: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } }
        },
        handler: async (params: { city: string }) => ({ temp: 72, city: params.city })
      });

      // Mock LLM that calls tools
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }]
        },
        { fullText: 'The weather in NYC is 72 degrees.', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const toolStart = events.find(e => 'type' in e && e.type === 'tool-call-start') as ToolCallStartEvent | undefined;
      const toolEnd = events.find(e => 'type' in e && e.type === 'tool-call-end') as ToolCallEndEvent | undefined;

      expect(toolStart).toBeDefined();
      expect(toolStart?.name).toBe('get_weather');
      expect(toolStart?.callId).toBe('call1');

      expect(toolEnd).toBeDefined();
      expect(toolEnd?.callId).toBe('call1');
      expect(toolEnd?.result).toEqual({ temp: 72, city: 'NYC' });
    });
  });

  describe('Stage Transitions', () => {
    it('should yield stage-change event on keyword transition in LLM response', async () => {
      // Mock LLM that responds with keywords triggering transition
      // Note: Keyword transitions are evaluated on the LLM's RESPONSE, not user input
      llmProvider = createMockLLMProvider([
        { fullText: 'Sure, I can help you with that!', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const stageChange = events.find(e => 'type' in e && e.type === 'stage-change') as StageChangeEvent | undefined;

      expect(stageChange).toBeDefined();
      expect(stageChange?.from).toBe('greeting');
      expect(stageChange?.to).toBe('main');
    });

    it('should yield stage-change event on playbook_transition tool call', async () => {
      // Mock LLM that calls playbook_transition
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{
            callId: 'trans1',
            name: 'playbook_transition',
            arguments: { targetStage: 'main', reason: 'User needs help' }
          }]
        },
        { fullText: 'Moving to help you!', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const stageChange = events.find(e => 'type' in e && e.type === 'stage-change') as StageChangeEvent | undefined;

      expect(stageChange).toBeDefined();
      expect(stageChange?.to).toBe('main');
    });
  });

  describe('Sentence Chunking', () => {
    it('should split text into sentences for TTS streaming', async () => {
      llmProvider = createMockLLMProvider([
        { fullText: 'Hello there. How are you? I am fine!', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        streamingTTS: true
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const ttsChunks = events.filter(e => 'type' in e && e.type === 'tts-chunk');
      // Should have 3 chunks for 3 sentences
      expect(ttsChunks.length).toBe(3);
    });

    it('should use custom sentence chunker if provided', async () => {
      llmProvider = createMockLLMProvider([
        { fullText: 'Hello,there,friend', stopReason: 'end_turn' }
      ]);

      const customChunker = (text: string) => text.split(',');

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        streamingTTS: true,
        sentenceChunker: customChunker
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const ttsChunks = events.filter(e => 'type' in e && e.type === 'tts-chunk');
      expect(ttsChunks.length).toBe(3);
    });
  });

  describe('Hooks Integration', () => {
    it('should call onTurnStart hook', async () => {
      const onTurnStart = vi.fn();
      const hooks: OrchestratorHooks = { onTurnStart };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      expect(onTurnStart).toHaveBeenCalled();
    });

    it('should call onSTTStart and onSTTEnd hooks', async () => {
      const onSTTStart = vi.fn();
      const onSTTEnd = vi.fn();
      const hooks: OrchestratorHooks = { onSTTStart, onSTTEnd };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(onSTTStart).toHaveBeenCalled();
      expect(onSTTEnd).toHaveBeenCalled();
    });

    it('should call onLLMStart and onLLMEnd hooks', async () => {
      const onLLMStart = vi.fn();
      const onLLMEnd = vi.fn();
      const hooks: OrchestratorHooks = { onLLMStart, onLLMEnd };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(onLLMStart).toHaveBeenCalled();
      expect(onLLMEnd).toHaveBeenCalled();
    });

    it('should call onTTSStart and onTTSEnd hooks', async () => {
      const onTTSStart = vi.fn();
      const onTTSEnd = vi.fn();
      const hooks: OrchestratorHooks = { onTTSStart, onTTSEnd };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(onTTSStart).toHaveBeenCalled();
      expect(onTTSEnd).toHaveBeenCalled();
    });

    it('should call onTurnEnd hook', async () => {
      const onTurnEnd = vi.fn();
      const hooks: OrchestratorHooks = { onTurnEnd };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(onTurnEnd).toHaveBeenCalled();
    });

    it('should call onSTTError hook on STT failure', async () => {
      const onSTTError = vi.fn();
      const hooks: OrchestratorHooks = { onSTTError };

      const failingSTT: STTProvider = {
        name: 'failing-stt',
        async transcribe() {
          throw new Error('STT failed');
        }
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: failingSTT, tts: ttsProvider },
        playbook,
        toolRegistry,
        hooks
      });

      try {
        for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
          // consume events
        }
      } catch (e) {
        // expected
      }

      expect(onSTTError).toHaveBeenCalled();
    });
  });

  describe('Metrics Integration', () => {
    it('should record STT timing metrics', async () => {
      const timing = vi.fn();
      const metrics: MetricsAdapter = {
        increment: vi.fn(),
        timing,
        gauge: vi.fn()
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(timing).toHaveBeenCalledWith(
        expect.stringContaining('stt'),
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should record LLM timing metrics', async () => {
      const timing = vi.fn();
      const metrics: MetricsAdapter = {
        increment: vi.fn(),
        timing,
        gauge: vi.fn()
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(timing).toHaveBeenCalledWith(
        expect.stringContaining('llm'),
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should record TTS timing metrics', async () => {
      const timing = vi.fn();
      const metrics: MetricsAdapter = {
        increment: vi.fn(),
        timing,
        gauge: vi.fn()
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(timing).toHaveBeenCalledWith(
        expect.stringContaining('tts'),
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should record turn duration metrics', async () => {
      const timing = vi.fn();
      const metrics: MetricsAdapter = {
        increment: vi.fn(),
        timing,
        gauge: vi.fn()
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry,
        metrics
      });

      for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
        // consume events
      }

      expect(timing).toHaveBeenCalledWith(
        expect.stringContaining('turn'),
        expect.any(Number)
      );
    });

    it('should increment error counter on STT failure', async () => {
      const increment = vi.fn();
      const metrics: MetricsAdapter = {
        increment,
        timing: vi.fn(),
        gauge: vi.fn()
      };

      const failingSTT: STTProvider = {
        name: 'failing-stt',
        async transcribe() {
          throw new Error('STT failed');
        }
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: failingSTT, tts: ttsProvider },
        playbook,
        toolRegistry,
        metrics
      });

      try {
        for await (const _ of orchestrator.runTurnStream(Buffer.from('audio'))) {
          // consume events
        }
      } catch (e) {
        // expected
      }

      expect(increment).toHaveBeenCalledWith(
        expect.stringContaining('error'),
        1,
        expect.objectContaining({ component: 'stt' })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty LLM response (no TTS)', async () => {
      llmProvider = createMockLLMProvider([
        { fullText: '', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      // Should not have TTS start/chunks/complete for empty response
      const ttsEvents = events.filter(e =>
        'type' in e && (e.type === 'tts-start' || e.type === 'tts-chunk' || e.type === 'tts-complete')
      );
      expect(ttsEvents.length).toBe(0);
    });

    it('should handle whitespace-only LLM response (no TTS)', async () => {
      llmProvider = createMockLLMProvider([
        { fullText: '   \n\t  ', stopReason: 'end_turn' }
      ]);

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      const ttsEvents = events.filter(e =>
        'type' in e && (e.type === 'tts-start' || e.type === 'tts-chunk' || e.type === 'tts-complete')
      );
      expect(ttsEvents.length).toBe(0);
    });

    it('should fallback to non-streaming TTS on stream error', async () => {
      const failingStreamTTS: TTSProvider = {
        name: 'failing-stream-tts',
        async speak(text: string) {
          return { audio: Buffer.from(`tts:${text}`), format: 'mp3' as const };
        },
        async *speakStream() {
          throw new Error('Stream failed');
        }
      };

      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: failingStreamTTS },
        playbook,
        toolRegistry,
        streamingTTS: true
      });

      const events: TurnOrchestratorYield[] = [];
      for await (const event of orchestrator.runTurnStream(Buffer.from('audio'))) {
        events.push(event);
      }

      // Should still have TTS output via fallback
      const ttsChunks = events.filter(e => 'type' in e && e.type === 'tts-chunk');
      expect(ttsChunks.length).toBeGreaterThan(0);
    });
  });

  describe('TurnOrchestrator Interface', () => {
    it('should implement TurnOrchestrator interface', () => {
      const orchestrator = new VoicePlaybookOrchestrator({
        providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
        playbook,
        toolRegistry
      });

      // Should have runTurnStream method
      expect(typeof orchestrator.runTurnStream).toBe('function');

      // Should have optional init method
      expect(typeof orchestrator.init).toBe('function');
    });
  });
});
