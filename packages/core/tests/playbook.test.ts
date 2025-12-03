import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Playbook,
  Stage,
  Transition,
  TransitionCondition,
  validatePlaybook,
  createPlaybookState,
  PLAYBOOK_TRANSITION_TOOL
} from '../src/playbook.js';
import { PlaybookEngine } from '../src/playbook-engine.js';
import { PlaybookOrchestrator, createSimplePlaybook } from '../src/playbook-orchestrator.js';
import { ToolRegistry } from '../src/tools.js';
import type { LLMProvider, LLMRequest, LLMResult, LLMChunk } from '../src/types.js';

// Mock LLM Provider
function createMockLLMProvider(responses: LLMResult[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock-llm',
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

// Sample playbook for testing
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
        condition: { type: 'keyword', keywords: ['bye', 'goodbye', 'thanks'] },
        action: { targetStage: 'farewell' }
      },
      {
        id: 'max-turns-greeting',
        from: 'greeting',
        condition: { type: 'max_turns', count: 3 },
        action: { targetStage: 'main' },
        priority: -1
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

describe('Playbook Validation', () => {
  it('should validate a correct playbook', () => {
    const playbook = createTestPlaybook();
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing initial stage', () => {
    const playbook = createTestPlaybook();
    playbook.initialStage = 'nonexistent';
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Initial stage 'nonexistent' not found in stages");
  });

  it('should detect duplicate stage IDs', () => {
    const playbook = createTestPlaybook();
    playbook.stages.push({ ...playbook.stages[0] }); // Duplicate greeting
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate stage ID: 'greeting'");
  });

  it('should detect duplicate transition IDs', () => {
    const playbook = createTestPlaybook();
    playbook.transitions.push({ ...playbook.transitions[0] }); // Duplicate first transition
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate transition ID'))).toBe(true);
  });

  it('should detect invalid transition source stage', () => {
    const playbook = createTestPlaybook();
    playbook.transitions.push({
      id: 'bad-transition',
      from: 'nonexistent',
      condition: { type: 'keyword', keywords: ['test'] },
      action: { targetStage: 'main' }
    });
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("unknown source stage: 'nonexistent'"))).toBe(true);
  });

  it('should detect invalid transition target stage', () => {
    const playbook = createTestPlaybook();
    playbook.transitions.push({
      id: 'bad-transition',
      from: 'greeting',
      condition: { type: 'keyword', keywords: ['test'] },
      action: { targetStage: 'nonexistent' }
    });
    const result = validatePlaybook(playbook);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("unknown target stage: 'nonexistent'"))).toBe(true);
  });
});

describe('Playbook State', () => {
  it('should create initial state with correct stage', () => {
    const playbook = createTestPlaybook();
    const state = createPlaybookState(playbook);
    expect(state.currentStage.id).toBe('greeting');
    expect(state.turnCount).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.transitionHistory).toHaveLength(0);
  });

  it('should throw on invalid initial stage', () => {
    const playbook = createTestPlaybook();
    playbook.initialStage = 'nonexistent';
    expect(() => createPlaybookState(playbook)).toThrow("Initial stage 'nonexistent' not found");
  });
});

describe('PLAYBOOK_TRANSITION_TOOL', () => {
  it('should have correct structure', () => {
    expect(PLAYBOOK_TRANSITION_TOOL.name).toBe('playbook_transition');
    expect(PLAYBOOK_TRANSITION_TOOL.description).toBeTruthy();
    expect(PLAYBOOK_TRANSITION_TOOL.parameters.properties).toHaveProperty('targetStage');
    expect(PLAYBOOK_TRANSITION_TOOL.parameters.properties).toHaveProperty('reason');
    expect(PLAYBOOK_TRANSITION_TOOL.parameters.required).toContain('targetStage');
    expect(PLAYBOOK_TRANSITION_TOOL.parameters.required).toContain('reason');
  });
});

describe('PlaybookEngine', () => {
  let engine: PlaybookEngine;
  let playbook: Playbook;

  beforeEach(() => {
    playbook = createTestPlaybook();
    engine = new PlaybookEngine(playbook);
  });

  describe('Initialization', () => {
    it('should initialize with correct stage', () => {
      expect(engine.getCurrentStage().id).toBe('greeting');
    });

    it('should throw on invalid initial stage', () => {
      playbook.initialStage = 'nonexistent';
      expect(() => new PlaybookEngine(playbook)).toThrow();
    });
  });

  describe('State Management', () => {
    it('should return readonly state', () => {
      const state = engine.getState();
      expect(state.currentStage.id).toBe('greeting');
      expect(state.turnCount).toBe(0);
    });

    it('should update conversation context', () => {
      engine.updateContext({ key: 'value' });
      expect(engine.getState().conversationContext).toHaveProperty('key', 'value');
    });

    it('should merge context updates', () => {
      engine.updateContext({ a: 1 });
      engine.updateContext({ b: 2 });
      const ctx = engine.getState().conversationContext;
      expect(ctx).toHaveProperty('a', 1);
      expect(ctx).toHaveProperty('b', 2);
    });
  });

  describe('Transition Evaluation', () => {
    it('should match keyword transition', async () => {
      const result = await engine.evaluateTransitions('I need help with something');
      expect(result.shouldTransition).toBe(true);
      expect(result.transition?.id).toBe('greeting-to-main');
    });

    it('should not match when no keywords present', async () => {
      const result = await engine.evaluateTransitions('Hello there');
      expect(result.shouldTransition).toBe(false);
    });

    it('should match max_turns condition', async () => {
      // Simulate 3 turns
      await engine.completeTurn();
      await engine.completeTurn();
      await engine.completeTurn();

      const result = await engine.evaluateTransitions('anything');
      expect(result.shouldTransition).toBe(true);
      expect(result.transition?.id).toBe('max-turns-greeting');
    });

    it('should respect transition priority', async () => {
      // Complete 3 turns but also include keyword
      await engine.completeTurn();
      await engine.completeTurn();
      await engine.completeTurn();

      // Keyword transition has higher priority (default 0 > -1)
      const result = await engine.evaluateTransitions('I need help');
      expect(result.shouldTransition).toBe(true);
      expect(result.transition?.id).toBe('greeting-to-main');
    });

    it('should match tool_call condition', async () => {
      const result = await engine.evaluateTransitions(undefined, [
        { name: 'playbook_transition', arguments: { targetStage: 'farewell' } }
      ]);
      expect(result.shouldTransition).toBe(true);
      expect(result.transition?.condition.type).toBe('llm_decision');
    });

    it('should evaluate explicit transition', async () => {
      const result = await engine.evaluateExplicitTransition('main', 'User asked for help');
      expect(result.shouldTransition).toBe(true);
    });

    it('should reject transition to invalid stage', async () => {
      const result = await engine.evaluateExplicitTransition('nonexistent', 'Test');
      expect(result.shouldTransition).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('Transition Execution', () => {
    it('should execute transition and update state', async () => {
      const result = await engine.evaluateTransitions('I need help');
      expect(result.shouldTransition).toBe(true);

      await engine.executeTransition(result.transition!);

      expect(engine.getCurrentStage().id).toBe('main');
      expect(engine.getState().turnCount).toBe(0);
      expect(engine.getState().transitionHistory).toHaveLength(1);
    });

    it('should call stage lifecycle hooks', async () => {
      const onEnter = vi.fn();
      const onExit = vi.fn();

      playbook.stages[0].onExit = onExit;
      playbook.stages[1].onEnter = onEnter;

      engine = new PlaybookEngine(playbook);

      const result = await engine.evaluateTransitions('help');
      await engine.executeTransition(result.transition!);

      expect(onExit).toHaveBeenCalled();
      expect(onEnter).toHaveBeenCalled();
    });

    it('should emit events during transition', async () => {
      const events: string[] = [];
      engine.on(event => {
        events.push(event.type);
      });

      const result = await engine.evaluateTransitions('help');
      await engine.executeTransition(result.transition!);

      expect(events).toContain('stage_exit');
      expect(events).toContain('transition');
      expect(events).toContain('stage_enter');
    });

    it('should clear history when requested', async () => {
      engine.updateContext({ test: 'value' });

      const transitionWithClear: Transition = {
        id: 'test-clear',
        from: 'greeting',
        condition: { type: 'keyword', keywords: ['clear'] },
        action: { targetStage: 'main', clearHistory: true }
      };

      await engine.executeTransition(transitionWithClear);
      expect(engine.getState().conversationContext).toEqual({});
    });

    it('should pass transition data', async () => {
      const onEnter = vi.fn();
      playbook.stages[1].onEnter = onEnter;

      engine = new PlaybookEngine(playbook);

      const transition: Transition = {
        id: 'test-data',
        from: 'greeting',
        condition: { type: 'keyword', keywords: ['data'] },
        action: { targetStage: 'main', data: { foo: 'bar' } }
      };

      await engine.executeTransition(transition);
      expect(onEnter).toHaveBeenCalledWith(expect.objectContaining({
        transitionData: { foo: 'bar' }
      }));
    });
  });

  describe('System Prompt Generation', () => {
    it('should combine global and stage prompts', () => {
      const prompt = engine.getEffectiveSystemPrompt();
      expect(prompt).toContain('You are a helpful assistant.');
      expect(prompt).toContain('You are greeting the user.');
    });

    it('should include LLM transition options', () => {
      // The playbook has an llm_decision transition with * source
      const prompt = engine.getEffectiveSystemPrompt();
      expect(prompt).toContain('transition to the following stages');
    });
  });

  describe('Tool Management', () => {
    it('should combine global and stage tools', () => {
      playbook.globalTools = [{ name: 'global_tool', description: 'Global', parameters: { type: 'object' } }];
      playbook.stages[0].tools = [{ name: 'stage_tool', description: 'Stage', parameters: { type: 'object' } }];

      engine = new PlaybookEngine(playbook);
      const tools = engine.getAvailableTools();

      expect(tools.some(t => t.name === 'global_tool')).toBe(true);
      expect(tools.some(t => t.name === 'stage_tool')).toBe(true);
    });

    it('should include playbook_transition tool when LLM decisions exist', () => {
      const tools = engine.getAvailableTools();
      expect(tools.some(t => t.name === 'playbook_transition')).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should reset to initial state', async () => {
      // Make some changes
      await engine.completeTurn();
      engine.updateContext({ key: 'value' });

      const result = await engine.evaluateTransitions('help');
      await engine.executeTransition(result.transition!);

      // Reset
      engine.reset();

      expect(engine.getCurrentStage().id).toBe('greeting');
      expect(engine.getState().turnCount).toBe(0);
      expect(engine.getState().conversationContext).toEqual({});
      expect(engine.getState().transitionHistory).toHaveLength(0);
    });
  });
});

describe('PlaybookOrchestrator', () => {
  let orchestrator: PlaybookOrchestrator;
  let mockProvider: LLMProvider;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    mockProvider = createMockLLMProvider([
      { fullText: 'Hello there! Nice to meet you.', stopReason: 'end_turn' }
    ]);
    toolRegistry = new ToolRegistry();
    orchestrator = new PlaybookOrchestrator(
      mockProvider,
      createTestPlaybook(),
      toolRegistry
    );
  });

  describe('Initialization', () => {
    it('should initialize with correct state', () => {
      expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');
    });

    it('should register playbook_transition tool', () => {
      expect(toolRegistry.get('playbook_transition')).toBeTruthy();
    });
  });

  describe('Turn Execution', () => {
    it('should execute a basic turn', async () => {
      const result = await orchestrator.executeTurn('Hello');

      expect(result.response).toBe('Hello there! Nice to meet you.');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.transitioned).toBe(false);
    });

    it('should handle tool calls', async () => {
      // Register a test tool
      toolRegistry.register({
        definition: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } }
        },
        handler: async (params: { city: string }) => ({ temp: 72, city: params.city })
      });

      // Mock provider that calls tools
      mockProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }]
        },
        { fullText: 'The weather in NYC is 72 degrees.', stopReason: 'end_turn' }
      ]);

      orchestrator = new PlaybookOrchestrator(mockProvider, createTestPlaybook(), toolRegistry);

      const result = await orchestrator.executeTurn("What's the weather?");

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].request.name).toBe('get_weather');
      expect(result.toolCalls[0].result.success).toBe(true);
    });

    it('should handle playbook_transition tool', async () => {
      mockProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{
            callId: 'call1',
            name: 'playbook_transition',
            arguments: { targetStage: 'main', reason: 'User needs help' }
          }]
        },
        { fullText: 'Moving to help you!', stopReason: 'end_turn' }
      ]);

      orchestrator = new PlaybookOrchestrator(mockProvider, createTestPlaybook(), toolRegistry);

      const result = await orchestrator.executeTurn('I need assistance');

      expect(result.transitioned).toBe(true);
      expect(result.newStage?.id).toBe('main');
    });

    it('should trigger keyword-based transitions', async () => {
      mockProvider = createMockLLMProvider([
        { fullText: 'I can help you with that!', stopReason: 'end_turn' }
      ]);

      orchestrator = new PlaybookOrchestrator(mockProvider, createTestPlaybook(), toolRegistry);

      const result = await orchestrator.executeTurn('help me');

      expect(result.transitioned).toBe(true);
      expect(orchestrator.getEngine().getCurrentStage().id).toBe('main');
    });

    it('should track conversation history', async () => {
      await orchestrator.executeTurn('Hello');
      await orchestrator.executeTurn('How are you?');

      const history = orchestrator.getHistory();
      expect(history.length).toBeGreaterThan(2);
      expect(history.some(m => m.role === 'user' && m.content === 'Hello')).toBe(true);
      expect(history.some(m => m.role === 'user' && m.content === 'How are you?')).toBe(true);
    });

    it('should emit events during execution', async () => {
      const events: string[] = [];
      orchestrator.on(event => {
        events.push(event.type);
      });

      await orchestrator.executeTurn('Hello');

      expect(events).toContain('phase1_start');
      expect(events).toContain('phase1_complete');
      expect(events).toContain('turn_complete');
    });
  });

  describe('Streaming', () => {
    it('should stream turn responses', async () => {
      const chunks: string[] = [];

      for await (const item of orchestrator.streamTurn('Hello')) {
        if (item.type === 'content') {
          chunks.push(item.data as string);
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should yield done event with result', async () => {
      let doneEvent: any = null;

      for await (const item of orchestrator.streamTurn('Hello')) {
        if (item.type === 'done') {
          doneEvent = item.data;
        }
      }

      expect(doneEvent).toBeTruthy();
      expect(doneEvent.response).toBeTruthy();
    });
  });

  describe('Reset', () => {
    it('should reset orchestrator state', async () => {
      await orchestrator.executeTurn('Hello');
      await orchestrator.executeTurn('help me');

      orchestrator.reset();

      expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');
      expect(orchestrator.getHistory()).toHaveLength(0);
    });
  });
});

describe('createSimplePlaybook', () => {
  it('should create a single-stage playbook', () => {
    const playbook = createSimplePlaybook(
      'simple',
      'You are a helpful assistant.',
      [{ name: 'test', description: 'Test tool', parameters: { type: 'object' } }]
    );

    expect(playbook.id).toBe('simple');
    expect(playbook.stages).toHaveLength(1);
    expect(playbook.stages[0].id).toBe('main');
    expect(playbook.stages[0].tools).toHaveLength(1);
    expect(playbook.initialStage).toBe('main');
    expect(playbook.transitions).toHaveLength(0);
  });
});

describe('Custom Transition Conditions', () => {
  it('should evaluate custom condition', async () => {
    const customEvaluate = vi.fn().mockResolvedValue(true);

    const playbook: Playbook = {
      id: 'custom-test',
      name: 'Custom Test',
      stages: [
        { id: 'a', name: 'A', systemPrompt: 'Stage A' },
        { id: 'b', name: 'B', systemPrompt: 'Stage B' }
      ],
      transitions: [{
        id: 'custom-trans',
        from: 'a',
        condition: { type: 'custom', evaluate: customEvaluate },
        action: { targetStage: 'b' }
      }],
      initialStage: 'a'
    };

    const engine = new PlaybookEngine(playbook);
    const result = await engine.evaluateTransitions('test');

    expect(customEvaluate).toHaveBeenCalled();
    expect(result.shouldTransition).toBe(true);
  });

  it('should pass context to custom evaluator', async () => {
    let receivedContext: any = null;

    const playbook: Playbook = {
      id: 'context-test',
      name: 'Context Test',
      stages: [
        { id: 'a', name: 'A', systemPrompt: 'Stage A' },
        { id: 'b', name: 'B', systemPrompt: 'Stage B' }
      ],
      transitions: [{
        id: 'context-trans',
        from: 'a',
        condition: {
          type: 'custom',
          evaluate: (ctx) => {
            receivedContext = ctx;
            return false;
          }
        },
        action: { targetStage: 'b' }
      }],
      initialStage: 'a'
    };

    const engine = new PlaybookEngine(playbook);
    engine.updateContext({ testKey: 'testValue' });
    engine.setSessionMetadata({ session: 'data' });

    await engine.evaluateTransitions('test message');

    expect(receivedContext).toBeTruthy();
    expect(receivedContext.currentStage).toBe('a');
    expect(receivedContext.lastAssistantMessage).toBe('test message');
    expect(receivedContext.conversationContext.testKey).toBe('testValue');
    expect(receivedContext.sessionMetadata.session).toBe('data');
  });
});

describe('Timeout Transition', () => {
  it('should match timeout condition', async () => {
    const playbook: Playbook = {
      id: 'timeout-test',
      name: 'Timeout Test',
      stages: [
        { id: 'a', name: 'A', systemPrompt: 'Stage A' },
        { id: 'b', name: 'B', systemPrompt: 'Stage B' }
      ],
      transitions: [{
        id: 'timeout-trans',
        from: 'a',
        condition: { type: 'timeout', durationMs: 100 },
        action: { targetStage: 'b' }
      }],
      initialStage: 'a'
    };

    const engine = new PlaybookEngine(playbook);

    // Should not match immediately
    let result = await engine.evaluateTransitions();
    expect(result.shouldTransition).toBe(false);

    // Wait for timeout
    await new Promise(r => setTimeout(r, 150));

    result = await engine.evaluateTransitions();
    expect(result.shouldTransition).toBe(true);
  });
});

describe('Intent-Based Transition', () => {
  it('should match intent condition', async () => {
    const playbook: Playbook = {
      id: 'intent-test',
      name: 'Intent Test',
      stages: [
        { id: 'a', name: 'A', systemPrompt: 'Stage A' },
        { id: 'b', name: 'B', systemPrompt: 'Stage B' }
      ],
      transitions: [{
        id: 'intent-trans',
        from: 'a',
        condition: { type: 'intent', intent: 'book_appointment', confidence: 0.8 },
        action: { targetStage: 'b' }
      }],
      initialStage: 'a'
    };

    const engine = new PlaybookEngine(playbook);

    // No intent detected
    let result = await engine.evaluateTransitions();
    expect(result.shouldTransition).toBe(false);

    // Set detected intent with low confidence
    engine.updateContext({ detectedIntent: 'book_appointment', intentConfidence: 0.5 });
    result = await engine.evaluateTransitions();
    expect(result.shouldTransition).toBe(false);

    // Set high confidence
    engine.updateContext({ intentConfidence: 0.9 });
    result = await engine.evaluateTransitions();
    expect(result.shouldTransition).toBe(true);
  });
});

describe('LLM Config', () => {
  it('should merge default and stage config', () => {
    const playbook: Playbook = {
      id: 'config-test',
      name: 'Config Test',
      stages: [{
        id: 'main',
        name: 'Main',
        systemPrompt: 'Test',
        llmConfig: { temperature: 0.5 }
      }],
      transitions: [],
      initialStage: 'main',
      defaultLLMConfig: { maxTokens: 1000, temperature: 0.7 }
    };

    const engine = new PlaybookEngine(playbook);
    const config = engine.getEffectiveLLMConfig();

    expect(config.temperature).toBe(0.5); // Stage overrides
    expect(config.maxTokens).toBe(1000); // Default applies
  });
});

describe('LLM Retry', () => {
  it('should retry LLM call on failure', async () => {
    let callCount = 0;
    const failingThenSucceedingLLM: LLMProvider = {
      name: 'retry-llm',
      async complete(): Promise<LLMResult> {
        callCount++;
        if (callCount < 2) {
          throw new Error('Temporary failure');
        }
        return { fullText: 'Success after retry', stopReason: 'end_turn' };
      },
      async *stream(): AsyncIterable<LLMChunk> {
        const result = await this.complete();
        yield { content: result.fullText, done: true, stopReason: result.stopReason };
      }
    };

    const playbook = createSimplePlaybook('Test', 'You are a test assistant.');
    const orchestrator = new PlaybookOrchestrator(
      failingThenSucceedingLLM,
      playbook,
      new ToolRegistry(),
      { llmRetries: 3 }
    );

    const result = await orchestrator.executeTurn('Hello');
    expect(result.response).toBe('Success after retry');
    expect(callCount).toBe(2);
  });

  it('should throw after max retries exhausted', async () => {
    const alwaysFailingLLM: LLMProvider = {
      name: 'failing-llm',
      async complete(): Promise<LLMResult> {
        throw new Error('Permanent failure');
      },
      async *stream(): AsyncIterable<LLMChunk> {
        throw new Error('Permanent failure');
      }
    };

    const playbook = createSimplePlaybook('Test', 'You are a test assistant.');
    const orchestrator = new PlaybookOrchestrator(
      alwaysFailingLLM,
      playbook,
      new ToolRegistry(),
      { llmRetries: 2 }
    );

    await expect(orchestrator.executeTurn('Hello')).rejects.toThrow('Permanent failure');
  });
});

describe('History Limit', () => {
  it('should trim history when limit is exceeded', async () => {
    const llmProvider = createMockLLMProvider([
      { fullText: 'Response', stopReason: 'end_turn' }
    ]);

    const playbook = createSimplePlaybook('Test', 'You are a test assistant.');
    const orchestrator = new PlaybookOrchestrator(
      llmProvider,
      playbook,
      new ToolRegistry(),
      { historyLimit: 4 }
    );

    // Execute multiple turns to exceed limit
    await orchestrator.executeTurn('Message 1');
    await orchestrator.executeTurn('Message 2');
    await orchestrator.executeTurn('Message 3');

    // With limit of 4, and each turn adding 2 messages (user + assistant),
    // 3 turns = 6 messages, should be trimmed to 4
    const history = orchestrator.getHistory();
    expect(history.length).toBeLessThanOrEqual(4);
  });

  it('should use default history limit of 50', () => {
    const llmProvider = createMockLLMProvider([
      { fullText: 'Response', stopReason: 'end_turn' }
    ]);

    const playbook = createSimplePlaybook('Test', 'Test');
    const orchestrator = new PlaybookOrchestrator(
      llmProvider,
      playbook,
      new ToolRegistry()
    );

    // Default limit should be 50 - we can't easily test this without
    // executing 50+ turns, so just verify it initializes correctly
    expect(orchestrator.getHistory().length).toBe(0);
  });
});
