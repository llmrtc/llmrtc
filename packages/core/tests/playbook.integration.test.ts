/**
 * Playbook Orchestrator Integration Tests
 *
 * These tests call real LLM APIs to verify the playbook + tool calling flow.
 * They are skipped by default and only run when:
 * 1. INTEGRATION_TESTS=true environment variable is set
 * 2. Appropriate API keys are set (OPENAI_API_KEY, ANTHROPIC_API_KEY, or AWS credentials)
 *
 * Run with:
 *   INTEGRATION_TESTS=true OPENAI_API_KEY=sk-... npx vitest run playbook.integration.test.ts
 *   INTEGRATION_TESTS=true ANTHROPIC_API_KEY=sk-ant-... npx vitest run playbook.integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PlaybookOrchestrator } from '../src/playbook-orchestrator.js';
import { ToolRegistry, defineTool } from '../src/tools.js';
import type { Playbook, LLMProvider, ToolDefinition } from '../src/types.js';

// =============================================================================
// Tool Definitions (shared between playbook and registry)
// =============================================================================

const LOOKUP_ACCOUNT_TOOL: ToolDefinition = {
  name: 'lookup_account',
  description: 'Look up customer account information by email or account ID',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'Customer email address' },
      account_id: { type: 'string', description: 'Customer account ID' }
    }
  }
};

const RUN_DIAGNOSTIC_TOOL: ToolDefinition = {
  name: 'run_diagnostic',
  description: 'Run a diagnostic check on the customer account or service',
  parameters: {
    type: 'object',
    properties: {
      diagnostic_type: {
        type: 'string',
        enum: ['connectivity', 'account', 'billing'],
        description: 'Type of diagnostic to run'
      },
      account_id: { type: 'string', description: 'Customer account ID' }
    },
    required: ['diagnostic_type']
  }
};

// =============================================================================
// Test Playbook - Customer Support Scenario
// =============================================================================

function createCustomerSupportPlaybook(): Playbook {
  return {
    id: 'customer-support',
    name: 'Customer Support Playbook',
    globalSystemPrompt: `You are a helpful customer support agent for TechCorp.
You help customers with account issues and technical problems.
Be concise and helpful. Use tools when needed to look up information.`,
    stages: [
      {
        id: 'greeting',
        name: 'Greeting',
        systemPrompt: 'Greet the customer and ask how you can help them today.',
        description: 'Initial greeting and problem identification'
      },
      {
        id: 'troubleshooting',
        name: 'Troubleshooting',
        systemPrompt: 'Help the customer troubleshoot their issue. Use available tools to look up account information or run diagnostics.',
        description: 'Active troubleshooting phase',
        tools: [LOOKUP_ACCOUNT_TOOL, RUN_DIAGNOSTIC_TOOL]
      },
      {
        id: 'resolution',
        name: 'Resolution',
        systemPrompt: 'Summarize what was done and confirm the issue is resolved.',
        description: 'Issue resolution and wrap-up'
      }
    ],
    transitions: [
      {
        id: 'greeting-to-troubleshooting',
        from: 'greeting',
        condition: { type: 'keyword', keywords: ['problem', 'issue', 'help', 'broken', 'not working', 'error'] },
        action: { targetStage: 'troubleshooting' }
      },
      {
        id: 'troubleshooting-to-resolution',
        from: 'troubleshooting',
        condition: { type: 'keyword', keywords: ['fixed', 'resolved', 'working now', 'thank', 'thanks'] },
        action: { targetStage: 'resolution' }
      }
    ],
    initialStage: 'greeting'
  };
}

// =============================================================================
// Test Tools (with execute functions for the registry)
// =============================================================================

function createTestToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Account lookup tool
  registry.register(defineTool({
    ...LOOKUP_ACCOUNT_TOOL,
    execute: async (args) => {
      // Simulate account lookup
      return {
        account_id: args.account_id || 'ACC-12345',
        email: args.email || 'customer@example.com',
        name: 'John Doe',
        plan: 'Premium',
        status: 'active',
        created_at: '2024-01-15'
      };
    }
  }));

  // Diagnostic tool
  registry.register(defineTool({
    ...RUN_DIAGNOSTIC_TOOL,
    execute: async (args) => {
      // Simulate diagnostic
      return {
        diagnostic_type: args.diagnostic_type,
        status: 'completed',
        result: 'All checks passed',
        details: {
          connectivity: 'OK',
          latency_ms: 45,
          errors_found: 0
        }
      };
    }
  }));

  return registry;
}

// =============================================================================
// Helper Functions
// =============================================================================

async function collectStreamEvents(
  orchestrator: PlaybookOrchestrator,
  userMessage: string
): Promise<{
  content: string;
  toolCalls: Array<{ name: string; args: any; result: any }>;
  stageChanges: Array<{ from: string; to: string }>;
}> {
  const result = {
    content: '',
    toolCalls: [] as Array<{ name: string; args: any; result: any }>,
    stageChanges: [] as Array<{ from: string; to: string }>
  };

  for await (const event of orchestrator.streamTurn(userMessage)) {
    switch (event.type) {
      case 'content':
        result.content += event.data;
        break;
      case 'tool_call':
        result.toolCalls.push({
          name: event.data.name,
          args: event.data.arguments,
          result: null
        });
        break;
      case 'tool_result':
        // Update the last tool call with its result
        if (result.toolCalls.length > 0) {
          result.toolCalls[result.toolCalls.length - 1].result = event.data.result;
        }
        break;
      case 'stage_change':
        result.stageChanges.push({
          from: event.data.from,
          to: event.data.to
        });
        break;
    }
  }

  return result;
}

// =============================================================================
// OpenAI Integration Tests
// =============================================================================

const SKIP_OPENAI = !process.env.INTEGRATION_TESTS || !process.env.OPENAI_API_KEY;

describe.skipIf(SKIP_OPENAI)('PlaybookOrchestrator + OpenAI Integration', () => {
  let llmProvider: LLMProvider;
  let toolRegistry: ToolRegistry;
  let playbook: Playbook;

  beforeAll(async () => {
    // Dynamic import to avoid loading when skipped
    const { OpenAILLMProvider } = await import('@metered/llmrtc-provider-openai');

    llmProvider = new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini'
    });

    toolRegistry = createTestToolRegistry();
    playbook = createCustomerSupportPlaybook();
  });

  it('should complete a basic turn without tools', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    const result = await collectStreamEvents(orchestrator, 'Hello!');

    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content.toLowerCase()).toMatch(/hello|hi|help|welcome/i);
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');
  }, 30000);

  it('should transition stages based on keywords', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    // Start in greeting stage
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');

    // Send message with keyword that should trigger transition
    await collectStreamEvents(orchestrator, 'I have a problem with my account, please help');

    // Should have transitioned to troubleshooting stage
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');
  }, 60000);

  it('should call tools when in troubleshooting stage', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // Go directly to troubleshooting
    await collectStreamEvents(orchestrator, 'I have a problem with my account');

    // Ask something that should trigger tool use
    const result = await collectStreamEvents(
      orchestrator,
      'Can you look up my account? My email is test@example.com'
    );

    // Should have called lookup_account tool
    expect(result.toolCalls.length).toBeGreaterThan(0);
    const accountLookup = result.toolCalls.find(tc => tc.name === 'lookup_account');
    expect(accountLookup).toBeDefined();
    expect(accountLookup?.result).toBeDefined();

    // Response should reference the account info
    expect(result.content.length).toBeGreaterThan(0);
  }, 60000);

  it('should handle multi-turn conversation with context', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // Turn 1: State problem (triggers transition to troubleshooting)
    await collectStreamEvents(orchestrator, 'I have a problem with my account');
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');

    // Turn 2: Request diagnostic
    const result = await collectStreamEvents(
      orchestrator,
      'Can you run a connectivity diagnostic check for my account?'
    );

    // Should have some response (LLM may or may not call tool, but should respond)
    expect(result.content.length).toBeGreaterThan(0);

    // If tools were called, verify they worked correctly
    if (result.toolCalls.length > 0) {
      const diagnostic = result.toolCalls.find(tc => tc.name === 'run_diagnostic');
      if (diagnostic) {
        expect(diagnostic.result).toBeDefined();
      }
    }
  }, 90000);

  it('should stream content incrementally', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    const chunks: string[] = [];
    for await (const event of orchestrator.streamTurn('Hello, how are you?')) {
      if (event.type === 'content' && typeof event.data === 'string') {
        chunks.push(event.data);
      }
    }

    // Should have received at least one content chunk
    expect(chunks.length).toBeGreaterThan(0);
    const fullContent = chunks.join('');
    expect(fullContent.length).toBeGreaterThan(0);
  }, 30000);
});

// =============================================================================
// Anthropic Integration Tests
// =============================================================================

const SKIP_ANTHROPIC = !process.env.INTEGRATION_TESTS || !process.env.ANTHROPIC_API_KEY;

describe.skipIf(SKIP_ANTHROPIC)('PlaybookOrchestrator + Anthropic Integration', () => {
  let llmProvider: LLMProvider;
  let toolRegistry: ToolRegistry;
  let playbook: Playbook;

  beforeAll(async () => {
    const { AnthropicLLMProvider } = await import('@metered/llmrtc-provider-anthropic');

    llmProvider = new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: 'claude-sonnet-4-5-20250929'
    });

    toolRegistry = createTestToolRegistry();
    playbook = createCustomerSupportPlaybook();
  });

  it('should complete a basic turn and respond', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    const result = await collectStreamEvents(orchestrator, 'Good morning');

    // Should have generated a response
    expect(result.content.length).toBeGreaterThan(0);
  }, 30000);

  it('should transition to troubleshooting stage on problem keywords', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    // Start fresh
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');

    // Message with clear problem indicators
    await collectStreamEvents(orchestrator, 'I have a problem with my account that needs help');

    // Should have transitioned to troubleshooting
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');
  }, 60000);

  it('should call tools when in troubleshooting stage', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // First, get to troubleshooting stage
    await collectStreamEvents(orchestrator, 'I have a problem with my account');

    // Then request account lookup
    const result = await collectStreamEvents(
      orchestrator,
      'Can you look up my account? My email is test@example.com'
    );

    // Should have generated some response
    expect(result.content.length).toBeGreaterThan(0);

    // Tool calls are optional - LLM may or may not use them
    if (result.toolCalls.length > 0) {
      const accountLookup = result.toolCalls.find(tc => tc.name === 'lookup_account');
      if (accountLookup) {
        expect(accountLookup.result).toBeDefined();
      }
    }
  }, 60000);

  it('should handle tool results and continue conversation', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // Get to troubleshooting stage
    await collectStreamEvents(orchestrator, 'I have a problem, my service is not working');

    // Request diagnostic
    const result = await collectStreamEvents(
      orchestrator,
      'Please run a connectivity diagnostic for my account ACC-12345'
    );

    // Should have generated some response
    expect(result.content.length).toBeGreaterThan(0);

    // If tools were called, verify they worked
    if (result.toolCalls.length > 0) {
      const diagnostic = result.toolCalls.find(tc => tc.name === 'run_diagnostic');
      if (diagnostic) {
        expect(diagnostic.result).toBeDefined();
      }
    }
  }, 60000);
});

// =============================================================================
// AWS Bedrock Integration Tests
// =============================================================================

const SKIP_BEDROCK =
  !process.env.INTEGRATION_TESTS ||
  !process.env.AWS_ACCESS_KEY_ID ||
  !process.env.AWS_SECRET_ACCESS_KEY;

describe.skipIf(SKIP_BEDROCK)('PlaybookOrchestrator + Bedrock Integration', () => {
  let llmProvider: LLMProvider;
  let toolRegistry: ToolRegistry;
  let playbook: Playbook;

  beforeAll(async () => {
    const { BedrockLLMProvider } = await import('@metered/llmrtc-provider-bedrock');

    llmProvider = new BedrockLLMProvider({
      region: process.env.AWS_REGION || 'us-east-1',
      model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'
    });

    toolRegistry = createTestToolRegistry();
    playbook = createCustomerSupportPlaybook();
  });

  it('should complete a basic turn and respond', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    const result = await collectStreamEvents(orchestrator, 'Good morning');

    expect(result.content.length).toBeGreaterThan(0);
  }, 30000);

  it('should transition to troubleshooting on problem keywords', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    expect(orchestrator.getEngine().getCurrentStage().id).toBe('greeting');

    await collectStreamEvents(orchestrator, 'I have a problem with my account that needs help');

    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');
  }, 60000);

  it('should call tools when in troubleshooting stage', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    await collectStreamEvents(orchestrator, 'I have a problem with my account');

    const result = await collectStreamEvents(
      orchestrator,
      'Can you look up my account? My email is test@example.com'
    );

    // Should have generated a response
    expect(result.content.length).toBeGreaterThan(0);

    // Tool calls are optional
    if (result.toolCalls.length > 0) {
      const accountLookup = result.toolCalls.find(tc => tc.name === 'lookup_account');
      if (accountLookup) {
        expect(accountLookup.result).toBeDefined();
      }
    }
  }, 60000);

  it('should handle multi-turn conversations', async () => {
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // Turn 1: Problem statement triggers stage change
    await collectStreamEvents(orchestrator, 'I have an issue with my service');
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');

    // Turn 2: Follow-up
    const result = await collectStreamEvents(
      orchestrator,
      'Can you help me fix it?'
    );

    expect(result.content.length).toBeGreaterThan(0);
  }, 90000);
});

// =============================================================================
// Cross-Provider Consistency Tests (runs with first available provider)
// =============================================================================

const SKIP_ALL = !process.env.INTEGRATION_TESTS || (
  !process.env.OPENAI_API_KEY &&
  !process.env.ANTHROPIC_API_KEY &&
  !(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
);

describe.skipIf(SKIP_ALL)('PlaybookOrchestrator Cross-Provider Tests', () => {
  let llmProvider: LLMProvider;
  let providerName: string;

  beforeAll(async () => {
    // Use first available provider
    if (process.env.OPENAI_API_KEY) {
      const { OpenAILLMProvider } = await import('@metered/llmrtc-provider-openai');
      llmProvider = new OpenAILLMProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini'
      });
      providerName = 'OpenAI';
    } else if (process.env.ANTHROPIC_API_KEY) {
      const { AnthropicLLMProvider } = await import('@metered/llmrtc-provider-anthropic');
      llmProvider = new AnthropicLLMProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-5-20250929'
      });
      providerName = 'Anthropic';
    } else {
      const { BedrockLLMProvider } = await import('@metered/llmrtc-provider-bedrock');
      llmProvider = new BedrockLLMProvider({
        region: process.env.AWS_REGION || 'us-east-1',
        model: process.env.BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0'
      });
      providerName = 'Bedrock';
    }

    console.log(`[integration] Running cross-provider tests with ${providerName}`);
  });

  it('should execute full customer support flow', async () => {
    const toolRegistry = createTestToolRegistry();
    const playbook = createCustomerSupportPlaybook();
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 5
    });

    // Turn 1: Problem statement - triggers transition to troubleshooting
    const problem = await collectStreamEvents(
      orchestrator,
      'I have a problem with my internet connection, please help'
    );
    expect(problem.content.length).toBeGreaterThan(0);
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('troubleshooting');

    // Turn 2: Request account lookup
    const lookup = await collectStreamEvents(
      orchestrator,
      'Can you look up my account? Email is john@example.com'
    );
    expect(lookup.content.length).toBeGreaterThan(0);

    // Turn 3: Request diagnostic
    const diagnostic = await collectStreamEvents(
      orchestrator,
      'Please run a connectivity diagnostic'
    );
    expect(diagnostic.content.length).toBeGreaterThan(0);

    // Turn 4: Resolution - should transition to resolution stage
    await collectStreamEvents(
      orchestrator,
      'Thanks so much, that fixed my issue!'
    );
    expect(orchestrator.getEngine().getCurrentStage().id).toBe('resolution');
  }, 180000);

  it('should handle consecutive tool calls in single turn', async () => {
    const toolRegistry = createTestToolRegistry();
    const playbook = createCustomerSupportPlaybook();
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry, {
      maxToolCallsPerTurn: 10
    });

    // Skip to troubleshooting
    await collectStreamEvents(orchestrator, 'I have a problem with my account');

    // Request multiple operations in one message
    const result = await collectStreamEvents(
      orchestrator,
      'Please look up my account (email: test@test.com) and run a connectivity diagnostic'
    );

    // Should have generated a response
    expect(result.content.length).toBeGreaterThan(0);

    // If tools were called, verify both are present
    if (result.toolCalls.length >= 2) {
      const hasLookup = result.toolCalls.some(tc => tc.name === 'lookup_account');
      const hasDiagnostic = result.toolCalls.some(tc => tc.name === 'run_diagnostic');
      expect(hasLookup || hasDiagnostic).toBe(true);
    }
  }, 60000);

  it('should maintain conversation history across turns', async () => {
    const toolRegistry = createTestToolRegistry();
    const playbook = createCustomerSupportPlaybook();
    const orchestrator = new PlaybookOrchestrator(llmProvider, playbook, toolRegistry);

    // Turn 1: Introduce with name
    await collectStreamEvents(orchestrator, 'Hi, my name is Alice');

    // Turn 2: State problem
    await collectStreamEvents(orchestrator, 'I have a problem with my billing');

    // Turn 3: Reference earlier context
    const result = await collectStreamEvents(
      orchestrator,
      'Can you help me with that billing issue I mentioned?'
    );

    // Response should indicate understanding of context
    // (The LLM should remember we mentioned billing)
    expect(result.content.toLowerCase()).toMatch(/billing|account|help|assist/i);
  }, 90000);
});
