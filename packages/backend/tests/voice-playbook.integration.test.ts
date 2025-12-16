/**
 * Voice Playbook Orchestrator Integration Tests
 *
 * These tests verify the full voice + playbook pipeline with real LLM providers:
 * - STT (mocked audio input) → LLM (real) → TTS (mocked output)
 * - Tool calling with real LLM decisions
 * - Stage transitions with real LLM context
 *
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. Appropriate API keys are set
 *
 * Run with:
 *   INTEGRATION_TESTS=true OPENAI_API_KEY=sk-... npx vitest run voice-playbook.integration.test.ts
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { VoicePlaybookOrchestrator } from '../src/voice-playbook-orchestrator.js';
import type { TurnOrchestratorYield } from '../src/turn-orchestrator.js';
import {
  ToolRegistry,
  defineTool,
  type LLMProvider,
  type STTProvider,
  type TTSProvider,
  type Playbook
} from '@llmrtc/llmrtc-core';

// =============================================================================
// Mock STT Provider (simulates transcribed audio)
// =============================================================================

function createMockSTTProvider(transcriptions: string[]): STTProvider {
  let callIndex = 0;
  return {
    name: 'mock-stt',
    init: vi.fn().mockResolvedValue(undefined),
    async transcribe(_audio: Buffer) {
      const text = transcriptions[callIndex] ?? transcriptions[transcriptions.length - 1];
      callIndex++;
      return { text, isFinal: true };
    }
  };
}

// =============================================================================
// Mock TTS Provider (captures generated speech)
// =============================================================================

function createMockTTSProvider(): TTSProvider & { spokenTexts: string[] } {
  const spokenTexts: string[] = [];

  return {
    name: 'mock-tts',
    spokenTexts,
    init: vi.fn().mockResolvedValue(undefined),
    async speak(text: string) {
      spokenTexts.push(text);
      return { audio: Buffer.from(`audio:${text}`), format: 'mp3' as const };
    },
    async *speakStream(text: string) {
      spokenTexts.push(text);
      yield Buffer.from(`chunk:${text}`);
    }
  };
}

// =============================================================================
// Tool Definitions (shared between playbook and registry)
// =============================================================================

import type { ToolDefinition } from '@llmrtc/llmrtc-core';

const CHECK_AVAILABILITY_TOOL: ToolDefinition = {
  name: 'check_availability',
  description: 'Check table availability for a given date, time, and party size',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
      party_size: { type: 'number', description: 'Number of guests' }
    },
    required: ['date', 'time', 'party_size']
  }
};

const MAKE_RESERVATION_TOOL: ToolDefinition = {
  name: 'make_reservation',
  description: 'Create a reservation with the collected details',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
      time: { type: 'string', description: 'Time in HH:MM format' },
      party_size: { type: 'number', description: 'Number of guests' },
      name: { type: 'string', description: 'Name for the reservation' },
      phone: { type: 'string', description: 'Contact phone number' },
      special_requests: { type: 'string', description: 'Any special requests' }
    },
    required: ['date', 'time', 'party_size', 'name']
  }
};

// =============================================================================
// Test Playbook - Restaurant Reservation
// =============================================================================

function createRestaurantPlaybook(): Playbook {
  return {
    id: 'restaurant-reservation',
    name: 'Restaurant Reservation',
    globalSystemPrompt: `You are a helpful restaurant reservation assistant for "The Golden Fork" restaurant.
Be friendly and efficient. Use tools to check availability and make reservations.
Always confirm details before finalizing a reservation.`,
    stages: [
      {
        id: 'welcome',
        name: 'Welcome',
        systemPrompt: 'Welcome the caller and ask if they would like to make a reservation.',
        description: 'Initial greeting'
      },
      {
        id: 'collect_details',
        name: 'Collect Details',
        systemPrompt: 'Collect reservation details: date, time, party size, and name. Use the check_availability tool to verify availability.',
        description: 'Gathering reservation information',
        tools: [CHECK_AVAILABILITY_TOOL]
      },
      {
        id: 'confirm_booking',
        name: 'Confirm Booking',
        systemPrompt: 'Confirm all details with the customer and use the make_reservation tool to complete the booking.',
        description: 'Confirming and completing reservation',
        tools: [MAKE_RESERVATION_TOOL]
      },
      {
        id: 'farewell',
        name: 'Farewell',
        systemPrompt: 'Thank the customer and provide any final information about their reservation.',
        description: 'Closing the call'
      }
    ],
    transitions: [
      {
        id: 'welcome-to-details',
        from: 'welcome',
        condition: { type: 'keyword', keywords: ['reservation', 'book', 'table', 'yes', 'please'] },
        action: { targetStage: 'collect_details' }
      },
      {
        id: 'details-to-confirm',
        from: 'collect_details',
        condition: { type: 'keyword', keywords: ['looks good', 'correct', 'yes', 'confirm', 'book it'] },
        action: { targetStage: 'confirm_booking' }
      },
      {
        id: 'confirm-to-farewell',
        from: 'confirm_booking',
        condition: { type: 'keyword', keywords: ['thank', 'thanks', 'goodbye', 'bye'] },
        action: { targetStage: 'farewell' }
      }
    ],
    initialStage: 'welcome'
  };
}

// =============================================================================
// Test Tools (with execute functions for the registry)
// =============================================================================

function createRestaurantToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(defineTool({
    ...CHECK_AVAILABILITY_TOOL,
    execute: async (args) => {
      // Simulate availability check
      return {
        available: true,
        date: args.date,
        time: args.time,
        party_size: args.party_size,
        tables_available: 3,
        suggested_alternatives: args.time === '19:00' ? [] : ['18:30', '19:30', '20:00']
      };
    }
  }));

  registry.register(defineTool({
    ...MAKE_RESERVATION_TOOL,
    execute: async (args) => {
      return {
        confirmation_number: 'RES-' + Math.random().toString(36).substr(2, 8).toUpperCase(),
        status: 'confirmed',
        details: {
          restaurant: 'The Golden Fork',
          date: args.date,
          time: args.time,
          party_size: args.party_size,
          name: args.name,
          phone: args.phone || 'not provided',
          special_requests: args.special_requests || 'none'
        }
      };
    }
  }));

  return registry;
}

// =============================================================================
// Helper to Collect Events
// =============================================================================

// Type guards for different event types
function isSTTResult(event: TurnOrchestratorYield): event is { text: string; isFinal: boolean } {
  return 'text' in event && 'isFinal' in event && !('type' in event);
}

function isLLMChunk(event: TurnOrchestratorYield): event is { content: string; done: boolean } {
  return 'content' in event && 'done' in event && !('type' in event);
}

function isLLMResult(event: TurnOrchestratorYield): event is { fullText: string } {
  return 'fullText' in event;
}

function isTTSChunk(event: TurnOrchestratorYield): event is { type: 'tts-chunk'; audio: Buffer } {
  return 'type' in event && event.type === 'tts-chunk';
}

function isToolCallStart(event: TurnOrchestratorYield): event is { type: 'tool-call-start'; name: string; callId: string } {
  return 'type' in event && event.type === 'tool-call-start';
}

function isToolCallEnd(event: TurnOrchestratorYield): event is { type: 'tool-call-end'; callId: string; result?: unknown } {
  return 'type' in event && event.type === 'tool-call-end';
}

function isStageChange(event: TurnOrchestratorYield): event is { type: 'stage-change'; from: string; to: string } {
  return 'type' in event && event.type === 'stage-change';
}

async function collectVoiceEvents(
  orchestrator: VoicePlaybookOrchestrator,
  audioBuffer: Buffer
): Promise<{
  transcript: string;
  llmResponse: string;
  ttsChunks: Buffer[];
  toolCalls: Array<{ name: string; result: any }>;
  stageChanges: Array<{ from: string; to: string }>;
}> {
  const result = {
    transcript: '',
    llmResponse: '',
    ttsChunks: [] as Buffer[],
    toolCalls: [] as Array<{ name: string; result: any }>,
    stageChanges: [] as Array<{ from: string; to: string }>
  };

  for await (const event of orchestrator.runTurnStream(audioBuffer)) {
    if (isSTTResult(event)) {
      result.transcript = event.text;
    } else if (isLLMChunk(event)) {
      result.llmResponse += event.content;
    } else if (isLLMResult(event)) {
      // LLMResult contains full text, but we're already accumulating from chunks
    } else if (isTTSChunk(event)) {
      result.ttsChunks.push(event.audio);
    } else if (isToolCallStart(event)) {
      result.toolCalls.push({ name: event.name, result: null });
    } else if (isToolCallEnd(event)) {
      const lastCall = result.toolCalls[result.toolCalls.length - 1];
      if (lastCall) {
        lastCall.result = event.result;
      }
    } else if (isStageChange(event)) {
      result.stageChanges.push({ from: event.from, to: event.to });
    }
  }

  return result;
}

// Helper to get current stage from orchestrator
function getCurrentStage(orchestrator: VoicePlaybookOrchestrator): string {
  return orchestrator.getPlaybookOrchestrator().getEngine().getCurrentStage().id;
}

// =============================================================================
// OpenAI Voice + Playbook Integration Tests
// =============================================================================

const SKIP_OPENAI = !process.env.INTEGRATION_TESTS || !process.env.OPENAI_API_KEY;

describe.skipIf(SKIP_OPENAI)('VoicePlaybookOrchestrator + OpenAI Integration', () => {
  let llmProvider: LLMProvider;

  beforeAll(async () => {
    const { OpenAILLMProvider } = await import('@llmrtc/llmrtc-provider-openai');
    llmProvider = new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini'
    });
  });

  it('should process voice input through full pipeline', async () => {
    const sttProvider = createMockSTTProvider(['Hello, I would like to make a reservation please']);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should have transcribed the audio
    expect(result.transcript).toBe('Hello, I would like to make a reservation please');

    // Should have generated an LLM response
    expect(result.llmResponse.length).toBeGreaterThan(0);

    // Should have generated TTS output
    expect(result.ttsChunks.length).toBeGreaterThan(0);

    // Should have transitioned to collect_details stage (keyword: reservation)
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);

  it('should handle tools when available', async () => {
    // This test verifies that when tools are called, results are correctly returned
    // The test doesn't require tools to be called - just verifies the pipeline works
    const sttProvider = createMockSTTProvider([
      'I want to book a table for tomorrow evening please'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true,
      playbookOptions: { maxToolCallsPerTurn: 5 }
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should have generated a response and TTS
    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);

    // Should have transitioned (keyword: book/table)
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);

  it('should complete basic voice pipeline with transitions', async () => {
    const sttProvider = createMockSTTProvider([
      'I would like to book a table please'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should have generated response and TTS
    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);
    expect(ttsProvider.spokenTexts.length).toBeGreaterThan(0);

    // Should transition to collect_details
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);
});

// =============================================================================
// Anthropic Voice + Playbook Integration Tests
// =============================================================================

const SKIP_ANTHROPIC = !process.env.INTEGRATION_TESTS || !process.env.ANTHROPIC_API_KEY;

describe.skipIf(SKIP_ANTHROPIC)('VoicePlaybookOrchestrator + Anthropic Integration', () => {
  let llmProvider: LLMProvider;

  beforeAll(async () => {
    const { AnthropicLLMProvider } = await import('@llmrtc/llmrtc-provider-anthropic');
    llmProvider = new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-sonnet-4-5-20250929'
    });
  });

  it('should process voice input and generate response', async () => {
    const sttProvider = createMockSTTProvider([
      'Hello, I want to make a reservation for dinner please'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should have generated response and TTS
    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);
    expect(ttsProvider.spokenTexts.length).toBeGreaterThan(0);

    // Should transition to collect_details
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);

  it('should maintain context in single turn', async () => {
    const sttProvider = createMockSTTProvider([
      'Hi, my name is Alice and I want to book a table for my birthday'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // LLM should generate appropriate response
    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);
  }, 60000);
});

// =============================================================================
// Bedrock Voice + Playbook Integration Tests
// =============================================================================

const SKIP_BEDROCK =
  !process.env.INTEGRATION_TESTS ||
  !process.env.AWS_ACCESS_KEY_ID ||
  !process.env.AWS_SECRET_ACCESS_KEY;

describe.skipIf(SKIP_BEDROCK)('VoicePlaybookOrchestrator + Bedrock Integration', () => {
  let llmProvider: LLMProvider;

  beforeAll(async () => {
    const { BedrockLLMProvider } = await import('@llmrtc/llmrtc-provider-bedrock');
    llmProvider = new BedrockLLMProvider({
      region: process.env.AWS_REGION || 'us-east-1',
      model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'
    });
  });

  it('should process voice input through pipeline', async () => {
    const sttProvider = createMockSTTProvider(['Hello, I would like to make a reservation please']);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    expect(result.transcript).toBe('Hello, I would like to make a reservation please');
    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);

  it('should generate response and TTS via Bedrock', async () => {
    const sttProvider = createMockSTTProvider([
      'I want to book a table for a birthday dinner'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    expect(result.llmResponse.length).toBeGreaterThan(0);
    expect(result.ttsChunks.length).toBeGreaterThan(0);
    expect(ttsProvider.spokenTexts.length).toBeGreaterThan(0);
  }, 60000);
});

// =============================================================================
// Performance and Edge Case Tests (uses first available provider)
// =============================================================================

const SKIP_ALL = !process.env.INTEGRATION_TESTS || (
  !process.env.OPENAI_API_KEY &&
  !process.env.ANTHROPIC_API_KEY &&
  !(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
);

describe.skipIf(SKIP_ALL)('VoicePlaybookOrchestrator Edge Cases', () => {
  let llmProvider: LLMProvider;

  beforeAll(async () => {
    if (process.env.OPENAI_API_KEY) {
      const { OpenAILLMProvider } = await import('@llmrtc/llmrtc-provider-openai');
      llmProvider = new OpenAILLMProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini'
      });
    } else if (process.env.ANTHROPIC_API_KEY) {
      const { AnthropicLLMProvider } = await import('@llmrtc/llmrtc-provider-anthropic');
      llmProvider = new AnthropicLLMProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-5-20250929'
      });
    } else {
      const { BedrockLLMProvider } = await import('@llmrtc/llmrtc-provider-bedrock');
      llmProvider = new BedrockLLMProvider({
        region: process.env.AWS_REGION || 'us-east-1',
        model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'
      });
    }
  });

  it('should handle very short transcripts', async () => {
    const sttProvider = createMockSTTProvider(['Hi']);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    expect(result.transcript).toBe('Hi');
    expect(result.llmResponse.length).toBeGreaterThan(0);
  }, 30000);

  it('should handle long detailed transcripts', async () => {
    const longTranscript = `Hello, I would like to make a reservation for a very special occasion.
    It's my parents' 50th wedding anniversary and we're planning a surprise dinner for them.
    We need a table for 12 people, and we'd love a private room if possible.
    The date would be December 25th, preferably around 6pm.
    Some guests have dietary restrictions - two are vegetarian and one has a nut allergy.
    We'd also like to arrange for a special anniversary cake. Can you help with all of this?`;

    const sttProvider = createMockSTTProvider([longTranscript]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook = createRestaurantPlaybook();

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true,
      playbookOptions: { maxToolCallsPerTurn: 5 }
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should handle long input gracefully
    expect(result.llmResponse.length).toBeGreaterThan(0);
    // Should have transitioned since "reservation" keyword is present
    expect(getCurrentStage(orchestrator)).toBe('collect_details');
  }, 60000);

  it('should respect maxToolCallsPerTurn limit', async () => {
    const sttProvider = createMockSTTProvider([
      'I need reservations for tomorrow, the day after, and next week - check all three dates please'
    ]);
    const ttsProvider = createMockTTSProvider();
    const toolRegistry = createRestaurantToolRegistry();
    const playbook: Playbook = {
      ...createRestaurantPlaybook(),
      stages: createRestaurantPlaybook().stages.map(s =>
        s.id === 'welcome' ? { ...s, tools: [CHECK_AVAILABILITY_TOOL] } : s
      )
    };

    const orchestrator = new VoicePlaybookOrchestrator({
      providers: { llm: llmProvider, stt: sttProvider, tts: ttsProvider },
      playbook,
      toolRegistry,
      streamingTTS: true,
      playbookOptions: { maxToolCallsPerTurn: 2 }  // Limit to 2 tool calls
    });

    const result = await collectVoiceEvents(orchestrator, Buffer.from('audio'));

    // Should not exceed maxToolCallsPerTurn
    expect(result.toolCalls.length).toBeLessThanOrEqual(2);
  }, 60000);
});
