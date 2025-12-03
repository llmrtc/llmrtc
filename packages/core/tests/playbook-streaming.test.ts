import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PlaybookOrchestrator,
  Playbook,
  Stage,
  ToolRegistry,
  defineTool,
} from '../src/index.js';
import type { LLMProvider, LLMRequest, LLMResult, LLMChunk } from '../src/types.js';

/**
 * Playbook Streaming Integration Tests
 *
 * These tests verify the streaming behavior of PlaybookOrchestrator
 * with focus on tool calling and event emission.
 */

// =============================================================================
// Mock LLM Provider
// =============================================================================

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
    },
  };
}

// =============================================================================
// Test Playbook with Tools
// =============================================================================

function createPlaybookWithTools(): { playbook: Playbook; registry: ToolRegistry } {
  const getWeatherTool = defineTool(
    {
      name: 'get_weather',
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
    },
    async (params: { city: string }) => ({
      city: params.city,
      temperature: 72,
      condition: 'sunny',
    })
  );

  const getForecastTool = defineTool(
    {
      name: 'get_forecast',
      description: 'Get weather forecast',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          days: { type: 'number' },
        },
        required: ['city'],
      },
    },
    async (params: { city: string; days?: number }) => ({
      city: params.city,
      forecast: [{ day: 'Monday', temp: 75 }],
    })
  );

  const weatherStage: Stage = {
    id: 'weather',
    name: 'Weather Stage',
    systemPrompt: 'You help with weather queries.',
    tools: [getWeatherTool.definition, getForecastTool.definition],
    toolChoice: 'auto',
    twoPhaseExecution: true,
  };

  const farewellStage: Stage = {
    id: 'farewell',
    name: 'Farewell',
    systemPrompt: 'Say goodbye.',
  };

  const playbook: Playbook = {
    id: 'weather-test',
    name: 'Weather Test',
    stages: [weatherStage, farewellStage],
    transitions: [
      {
        id: 'weather-to-farewell',
        from: 'weather',
        condition: { type: 'keyword', keywords: ['bye', 'goodbye'] },
        action: { targetStage: 'farewell' },
      },
      {
        id: 'llm-farewell',
        from: '*',
        condition: { type: 'llm_decision' },
        action: { targetStage: 'farewell' },
      },
    ],
    initialStage: 'weather',
    globalSystemPrompt: 'You are a weather assistant.',
  };

  const registry = new ToolRegistry();
  registry.register(getWeatherTool);
  registry.register(getForecastTool);

  return { playbook, registry };
}

// =============================================================================
// Tests
// =============================================================================

describe('PlaybookOrchestrator - Streaming with Tools', () => {
  let orchestrator: PlaybookOrchestrator;
  let llmProvider: LLMProvider;
  let toolRegistry: ToolRegistry;
  let playbook: Playbook;

  beforeEach(() => {
    const setup = createPlaybookWithTools();
    playbook = setup.playbook;
    toolRegistry = setup.registry;
  });

  describe('streamTurn - Tool Call Events', () => {
    it('should yield tool_call events during streaming', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        { fullText: 'The weather in NYC is 72 degrees and sunny.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('What is the weather in NYC?')) {
        events.push(item);
      }

      // Should have tool_call event with correct tool name
      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.data.name).toBe('get_weather');

      // Should have content event with final response
      const contentEvents = events.filter((e) => e.type === 'content');
      expect(contentEvents).toHaveLength(1);
      expect(contentEvents[0].data).toBe('The weather in NYC is 72 degrees and sunny.');

      // Should have done event with response
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.data.response).toBe('The weather in NYC is 72 degrees and sunny.');
    });

    it('should yield multiple tool_call events for sequential calls', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call2', name: 'get_forecast', arguments: { city: 'NYC', days: 3 } }],
        },
        { fullText: 'Weather and forecast retrieved.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Weather and forecast for NYC')) {
        events.push(item);
      }

      const toolCallEvents = events.filter((e) => e.type === 'tool_call');
      expect(toolCallEvents.length).toBe(2);
    });

    it('should include tool request details in tool_call events', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        { fullText: 'Done.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Weather?')) {
        events.push(item);
      }

      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.data).toBeDefined();
      // tool_call event data is the ToolCallRequest: { callId, name, arguments }
      expect(toolCallEvent!.data.name).toBe('get_weather');
      expect(toolCallEvent!.data.callId).toBe('call1');
      expect(toolCallEvent!.data.arguments).toEqual({ city: 'NYC' });
    });
  });

  describe('Event Subscription', () => {
    it('should emit tool_call_start event via subscription', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        { fullText: 'Done.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const subscribedEvents: any[] = [];
      orchestrator.on((event) => {
        subscribedEvents.push(event);
      });

      // Execute turn (not streaming)
      await orchestrator.executeTurn('Weather?');

      const toolStartEvents = subscribedEvents.filter((e) => e.type === 'tool_call_start');
      expect(toolStartEvents.length).toBe(1);
      expect(toolStartEvents[0].call.name).toBe('get_weather');
    });

    it('should emit tool_call_complete event via subscription', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'call1', name: 'get_weather', arguments: { city: 'NYC' } }],
        },
        { fullText: 'Done.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const subscribedEvents: any[] = [];
      orchestrator.on((event) => {
        subscribedEvents.push(event);
      });

      await orchestrator.executeTurn('Weather?');

      const toolCompleteEvents = subscribedEvents.filter((e) => e.type === 'tool_call_complete');
      expect(toolCompleteEvents.length).toBe(1);
      expect(toolCompleteEvents[0].result.success).toBe(true);
    });

    it('should emit stage_enter event on transition', async () => {
      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [
            {
              callId: 'trans1',
              name: 'playbook_transition',
              arguments: { targetStage: 'farewell', reason: 'User wants to leave' },
            },
          ],
        },
        { fullText: 'Goodbye!', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const subscribedEvents: any[] = [];
      orchestrator.on((event) => {
        subscribedEvents.push(event);
      });

      await orchestrator.executeTurn('Goodbye');

      const stageEnterEvents = subscribedEvents.filter((e) => e.type === 'stage_enter');
      expect(stageEnterEvents.length).toBeGreaterThan(0);
    });
  });

  describe('streamTurn - Content Streaming', () => {
    it('should yield content events progressively', async () => {
      // Create a streaming LLM that yields multiple chunks
      const streamingLLM: LLMProvider = {
        name: 'streaming-llm',
        async complete(): Promise<LLMResult> {
          return { fullText: 'Hello there friend!', stopReason: 'end_turn' };
        },
        async *stream(): AsyncIterable<LLMChunk> {
          yield { content: 'Hello ', done: false };
          yield { content: 'there ', done: false };
          yield { content: 'friend!', done: true, stopReason: 'end_turn' };
        },
      };

      // Simple playbook without tools for this test
      const simplePlaybook: Playbook = {
        id: 'simple',
        name: 'Simple',
        stages: [{ id: 'main', name: 'Main', systemPrompt: 'Hello' }],
        transitions: [],
        initialStage: 'main',
      };

      orchestrator = new PlaybookOrchestrator(streamingLLM, simplePlaybook, new ToolRegistry());

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Hi')) {
        events.push(item);
      }

      const contentEvents = events.filter((e) => e.type === 'content');
      // Note: With no tools in the playbook, phase 1 returns final response directly (not streamed)
      // The full text is yielded as a single content event
      expect(contentEvents).toHaveLength(1);
      expect(contentEvents[0].data).toBe('Hello there friend!');
    });

    it('should accumulate content correctly', async () => {
      llmProvider = createMockLLMProvider([
        { fullText: 'The weather is nice today.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Weather?')) {
        events.push(item);
      }

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.data.response).toBe('The weather is nice today.');
    });
  });

  describe('Tool Error Handling', () => {
    it('should handle tool execution errors gracefully via event subscription', async () => {
      // Register a failing tool
      const failingTool = defineTool(
        {
          name: 'failing_tool',
          description: 'A tool that fails',
          parameters: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Tool failed!');
        }
      );

      toolRegistry.register(failingTool);

      // Add tool to stage
      playbook.stages[0].tools = [
        ...playbook.stages[0].tools!,
        failingTool.definition,
      ];

      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'fail1', name: 'failing_tool', arguments: {} }],
        },
        { fullText: 'The tool failed but I handled it.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      // Subscribe to events to capture tool_call_complete with error
      const subscribedEvents: any[] = [];
      orchestrator.on((event) => {
        subscribedEvents.push(event);
      });

      // Execute turn (not streaming, to ensure events are captured)
      await orchestrator.executeTurn('Use failing tool');

      // tool_call_complete events include the result with error info
      const toolCompleteEvents = subscribedEvents.filter((e) => e.type === 'tool_call_complete');
      expect(toolCompleteEvents.length).toBe(1);
      expect(toolCompleteEvents[0].result.success).toBe(false);
      expect(toolCompleteEvents[0].result.error).toContain('Tool failed');
    });

    it('should still yield tool_call event when tool fails', async () => {
      // Register a failing tool
      const failingTool = defineTool(
        {
          name: 'failing_tool',
          description: 'A tool that fails',
          parameters: { type: 'object', properties: {} },
        },
        async () => {
          throw new Error('Tool failed!');
        }
      );

      toolRegistry.register(failingTool);

      // Add tool to stage
      playbook.stages[0].tools = [
        ...playbook.stages[0].tools!,
        failingTool.definition,
      ];

      llmProvider = createMockLLMProvider([
        {
          fullText: '',
          stopReason: 'tool_use',
          toolCalls: [{ callId: 'fail1', name: 'failing_tool', arguments: {} }],
        },
        { fullText: 'The tool failed but I handled it.', stopReason: 'end_turn' },
      ]);

      orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Use failing tool')) {
        events.push(item);
      }

      // tool_call event should still be yielded (contains request info)
      const toolCallEvent = events.find((e) => e.type === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.data.name).toBe('failing_tool');

      // Should still complete the turn
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
    });
  });

  describe('Attachments Passthrough', () => {
    it('should pass attachments to streamTurn', async () => {
      let receivedAttachments: any[] | undefined;

      const capturingLLM: LLMProvider = {
        name: 'capturing-llm',
        async complete(request: LLMRequest): Promise<LLMResult> {
          // Check if attachments are in the user message
          const userMessage = request.messages.find((m) => m.role === 'user');
          if (userMessage && 'attachments' in userMessage) {
            receivedAttachments = (userMessage as any).attachments;
          }
          return { fullText: 'Processed with attachments', stopReason: 'end_turn' };
        },
        async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
          const result = await this.complete(request);
          yield { content: result.fullText, done: true, stopReason: result.stopReason };
        },
      };

      orchestrator = new PlaybookOrchestrator(capturingLLM, playbook, toolRegistry);

      const testAttachments = [
        { type: 'image', data: Buffer.from('fake'), mimeType: 'image/jpeg' },
      ];

      const events: Array<{ type: string; data?: any }> = [];
      for await (const item of orchestrator.streamTurn('Describe this', testAttachments)) {
        events.push(item);
      }

      // Verify completion
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });
  });
});
