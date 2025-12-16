/**
 * Playbook with Tool Calling Example
 *
 * This example demonstrates:
 * - Defining tools with JSON Schema parameters
 * - Creating a multi-stage playbook with transitions
 * - Using the PlaybookOrchestrator for two-phase turn execution
 * - Integrating hooks and metrics for observability
 *
 * Run: npx ts-node examples/playbook-tools/server.ts
 */

import {
  // Tool types and registry
  ToolRegistry,
  defineTool,
  ToolDefinition,

  // Playbook types
  Playbook,
  Stage,

  // Playbook engine and orchestrator
  PlaybookOrchestrator,

  // Hooks and metrics
  PlaybookHooks,
  OrchestratorHooks,
  ConsoleMetrics,
  MetricNames,
} from '@llmrtc/llmrtc-core';

import { OpenAILLMProvider } from '@llmrtc/llmrtc-provider-openai';

// =============================================================================
// 1. Define Tools
// =============================================================================

/**
 * Weather tool - looks up current weather for a city
 */
const getWeatherTool = defineTool(
  {
    name: 'get_weather',
    description: 'Get the current weather for a specified city',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'The city name to get weather for'
        },
        units: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature units (default: celsius)'
        }
      },
      required: ['city']
    }
  },
  async (params: { city: string; units?: string }) => {
    // Simulated weather lookup
    console.log(`[tool] Looking up weather for ${params.city}`);
    const temps: Record<string, number> = {
      'new york': 72,
      'london': 55,
      'tokyo': 68,
      'paris': 61,
    };
    const temp = temps[params.city.toLowerCase()] ?? 65;
    const isFahrenheit = params.units === 'fahrenheit';
    const displayTemp = isFahrenheit ? temp : Math.round((temp - 32) * 5/9);

    return {
      city: params.city,
      temperature: displayTemp,
      units: isFahrenheit ? 'F' : 'C',
      condition: 'partly cloudy'
    };
  }
);

/**
 * Calendar tool - schedules an appointment
 */
const scheduleAppointmentTool = defineTool(
  {
    name: 'schedule_appointment',
    description: 'Schedule an appointment in the calendar',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the appointment'
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format'
        },
        time: {
          type: 'string',
          description: 'Time in HH:MM format (24-hour)'
        },
        duration: {
          type: 'integer',
          description: 'Duration in minutes',
          minimum: 15,
          maximum: 480
        }
      },
      required: ['title', 'date', 'time']
    }
  },
  async (params: { title: string; date: string; time: string; duration?: number }) => {
    console.log(`[tool] Scheduling: ${params.title} on ${params.date} at ${params.time}`);
    return {
      success: true,
      appointmentId: `apt_${Date.now()}`,
      title: params.title,
      date: params.date,
      time: params.time,
      duration: params.duration ?? 30,
      message: `Appointment "${params.title}" scheduled for ${params.date} at ${params.time}`
    };
  }
);

/**
 * Search tool - searches for information
 */
const searchTool = defineTool(
  {
    name: 'search',
    description: 'Search for information on a given topic',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results (default: 5)',
          minimum: 1,
          maximum: 10
        }
      },
      required: ['query']
    }
  },
  async (params: { query: string; limit?: number }) => {
    console.log(`[tool] Searching for: ${params.query}`);
    // Simulated search results
    return {
      query: params.query,
      results: [
        { title: `Result 1 for "${params.query}"`, url: 'https://example.com/1' },
        { title: `Result 2 for "${params.query}"`, url: 'https://example.com/2' },
      ].slice(0, params.limit ?? 5)
    };
  }
);

// =============================================================================
// 2. Define Playbook Stages
// =============================================================================

const greetingStage: Stage = {
  id: 'greeting',
  name: 'Greeting',
  description: 'Welcome the user and understand their intent',
  systemPrompt: `You are a friendly AI assistant. Greet the user warmly and ask how you can help them today.
Keep the greeting brief and natural.`,
  maxTurns: 3, // Auto-transition after 3 turns
};

const assistanceStage: Stage = {
  id: 'assistance',
  name: 'Main Assistance',
  description: 'Help the user with their request using available tools',
  systemPrompt: `You are a helpful AI assistant. Help the user with their request.
You have access to the following tools:
- get_weather: Look up current weather for any city
- schedule_appointment: Schedule calendar appointments
- search: Search for information

Use tools when appropriate to provide accurate, helpful responses.
When the user seems satisfied or says goodbye, transition to the farewell stage.`,
  tools: [getWeatherTool.definition, scheduleAppointmentTool.definition, searchTool.definition],
  toolChoice: 'auto',
  twoPhaseExecution: true, // Enable tool loop + final response
};

const farewellStage: Stage = {
  id: 'farewell',
  name: 'Farewell',
  description: 'Say goodbye to the user',
  systemPrompt: `The conversation is ending. Say a friendly goodbye to the user.
Summarize any actions taken (appointments scheduled, information provided, etc.) if relevant.
Keep the farewell brief and warm.`,
};

// =============================================================================
// 3. Define Playbook with Transitions
// =============================================================================

const assistantPlaybook: Playbook = {
  id: 'assistant-playbook',
  name: 'Personal Assistant',
  description: 'A multi-stage assistant that greets users, helps with tasks, and says goodbye',
  version: '1.0.0',

  stages: [greetingStage, assistanceStage, farewellStage],

  transitions: [
    // From greeting: move to assistance when user mentions help keywords
    {
      id: 'greeting-to-assistance',
      from: 'greeting',
      condition: { type: 'keyword', keywords: ['help', 'need', 'can you', 'weather', 'schedule', 'search'] },
      action: { targetStage: 'assistance' }
    },

    // From greeting: auto-transition after max turns
    {
      id: 'greeting-timeout',
      from: 'greeting',
      condition: { type: 'max_turns', count: 3 },
      action: { targetStage: 'assistance' },
      priority: -1 // Lower priority than keyword match
    },

    // From assistance: move to farewell on goodbye keywords
    {
      id: 'assistance-to-farewell',
      from: 'assistance',
      condition: { type: 'keyword', keywords: ['bye', 'goodbye', 'thanks', 'thank you', 'done', 'finished'] },
      action: { targetStage: 'farewell' }
    },

    // Allow LLM to initiate transitions
    {
      id: 'llm-decision-farewell',
      from: '*', // From any stage
      condition: { type: 'llm_decision' },
      action: { targetStage: 'farewell' },
      description: 'LLM can transition to farewell when appropriate'
    }
  ],

  initialStage: 'greeting',

  globalSystemPrompt: `You are a helpful personal assistant.
Always be polite, concise, and helpful.
If you need to use a tool, explain what you're doing briefly.`,

  defaultLLMConfig: {
    temperature: 0.7,
    maxTokens: 500
  }
};

// =============================================================================
// 4. Set Up Hooks for Observability
// =============================================================================

const hooks: OrchestratorHooks & PlaybookHooks = {
  // Tool execution hooks
  onToolStart(ctx, request) {
    console.log(`\n[hook] Tool started: ${request.name}`);
    console.log(`  Args: ${JSON.stringify(request.arguments)}`);
  },

  onToolEnd(ctx, result, timing) {
    console.log(`[hook] Tool completed: ${result.toolName}`);
    console.log(`  Duration: ${timing.durationMs}ms`);
    console.log(`  Success: ${result.success}`);
  },

  onToolError(ctx, request, error) {
    console.error(`[hook] Tool error: ${request.name}`);
    console.error(`  Error: ${error.message}`);
  },

  // Playbook hooks
  onStageEnter(ctx, stage, previousStage) {
    console.log(`\n[hook] Entered stage: ${stage.name}`);
    if (previousStage) {
      console.log(`  From: ${previousStage.name}`);
    }
  },

  onStageExit(ctx, stage, nextStage, timing) {
    console.log(`[hook] Exiting stage: ${stage.name}`);
    console.log(`  Duration in stage: ${timing.durationMs}ms`);
  },

  onTransition(ctx, transition, from, to) {
    console.log(`\n[hook] Stage transition: ${from.name} -> ${to.name}`);
    console.log(`  Trigger: ${transition.condition.type}`);
  },

  onPlaybookTurnEnd(ctx, response, toolCallCount) {
    console.log(`\n[hook] Turn complete`);
    console.log(`  Tool calls: ${toolCallCount}`);
    console.log(`  Response length: ${response.length} chars`);
  }
};

// =============================================================================
// 5. Main Entry Point
// =============================================================================

async function main() {
  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.log('Note: OPENAI_API_KEY not set. Running in demo mode with mock responses.\n');
  }

  // Create tool registry and register tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(getWeatherTool);
  toolRegistry.register(scheduleAppointmentTool);
  toolRegistry.register(searchTool);

  console.log('Registered tools:', toolRegistry.names());

  // Create LLM provider (would use actual provider with API key)
  const llmProvider = new OpenAILLMProvider({
    apiKey: process.env.OPENAI_API_KEY ?? 'demo-key',
    model: 'gpt-4o-mini'
  });

  // Create playbook orchestrator
  const orchestrator = new PlaybookOrchestrator(
    llmProvider,
    assistantPlaybook,
    toolRegistry,
    {
      maxToolCallsPerTurn: 5,
      phase1TimeoutMs: 30000,
      debug: true
    }
  );

  // Subscribe to events
  orchestrator.on(event => {
    if (event.type === 'transition_triggered') {
      console.log(`\n>>> Transition triggered: ${event.transition.id}`);
    }
  });

  // Demo conversation
  console.log('\n=== Playbook Demo: Personal Assistant ===\n');
  console.log(`Initial stage: ${orchestrator.getEngine().getCurrentStage().name}\n`);

  const testMessages = [
    "Hello!",
    "What's the weather in Tokyo?",
    "Thanks, that's all I needed!"
  ];

  for (const message of testMessages) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`User: ${message}`);
    console.log('='.repeat(60));

    try {
      const result = await orchestrator.executeTurn(message);

      console.log(`\nAssistant: ${result.response}`);
      console.log(`\n[Info] Stage: ${orchestrator.getEngine().getCurrentStage().name}`);
      console.log(`[Info] Tool calls: ${result.toolCalls.length}`);
      console.log(`[Info] Transitioned: ${result.transitioned}`);

      if (result.transitioned && result.newStage) {
        console.log(`[Info] New stage: ${result.newStage.name}`);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  }

  console.log('\n=== Demo Complete ===');
  console.log(`Final stage: ${orchestrator.getEngine().getCurrentStage().name}`);
  console.log(`Total turns: ${orchestrator.getHistory().length / 2}`);
}

// Run if executed directly
main().catch(console.error);
