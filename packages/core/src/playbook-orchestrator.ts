/**
 * Playbook Orchestrator
 *
 * Orchestrates turn execution with two-phase model:
 * - Phase 1: Tool loop - LLM can call tools repeatedly until it decides to respond
 * - Phase 2: Final answer - Generate the user-facing response
 *
 * Integrates with STT/TTS for voice-based interactions.
 */

import type { LLMProvider, LLMRequest, LLMResult, Message } from './types.js';
import type { ToolDefinition, ToolCallRequest, ToolCallResult } from './tools.js';
import { ToolRegistry } from './tools.js';
import { ToolExecutor } from './tool-executor.js';
import { PlaybookEngine, PlaybookEvent, PlaybookEventListener } from './playbook-engine.js';
import type { Playbook, Stage, Transition } from './playbook.js';
import { PLAYBOOK_TRANSITION_TOOL } from './playbook.js';

/**
 * Options for the playbook orchestrator
 */
export interface PlaybookOrchestratorOptions {
  /** Maximum number of tool calls per turn in Phase 1 */
  maxToolCallsPerTurn?: number;
  /** Timeout for Phase 1 tool loop (ms) */
  phase1TimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom logger */
  logger?: {
    debug: (msg: string, ...args: unknown[]) => void;
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result of a single turn execution
 */
export interface TurnResult {
  /** The final assistant response */
  response: string;
  /** All tool calls made during the turn */
  toolCalls: Array<{ request: ToolCallRequest; result: ToolCallResult }>;
  /** Whether a stage transition occurred */
  transitioned: boolean;
  /** The transition that was triggered (if any) */
  transition?: Transition;
  /** New stage after transition (if any) */
  newStage?: Stage;
  /** Raw LLM responses */
  llmResponses: LLMResult[];
  /** Stop reason from final LLM call */
  stopReason?: string;
}

/**
 * Event emitted during turn execution
 */
export type OrchestratorEvent =
  | { type: 'phase1_start' }
  | { type: 'tool_call_start'; call: ToolCallRequest }
  | { type: 'tool_call_complete'; call: ToolCallRequest; result: ToolCallResult }
  | { type: 'phase1_complete'; toolCallCount: number }
  | { type: 'phase2_start' }
  | { type: 'phase2_complete'; response: string }
  | { type: 'transition_triggered'; transition: Transition }
  | PlaybookEvent;

/**
 * Listener for orchestrator events
 */
export type OrchestratorEventListener = (event: OrchestratorEvent) => void | Promise<void>;

/**
 * Playbook Orchestrator - Manages two-phase turn execution
 */
export class PlaybookOrchestrator {
  private readonly llmProvider: LLMProvider;
  private readonly engine: PlaybookEngine;
  private readonly toolRegistry: ToolRegistry;
  private readonly toolExecutor: ToolExecutor;
  private readonly options: PlaybookOrchestratorOptions;
  private readonly listeners: Set<OrchestratorEventListener> = new Set();
  private conversationHistory: Message[] = [];

  constructor(
    llmProvider: LLMProvider,
    playbook: Playbook,
    toolRegistry: ToolRegistry,
    options: PlaybookOrchestratorOptions = {}
  ) {
    this.llmProvider = llmProvider;
    this.engine = new PlaybookEngine(playbook, {
      debug: options.debug,
      logger: options.logger
    });
    this.toolRegistry = toolRegistry;
    this.toolExecutor = new ToolExecutor(toolRegistry, {
      timeout: 30000,
      maxConcurrency: 5
    });
    this.options = {
      maxToolCallsPerTurn: 10,
      phase1TimeoutMs: 60000,
      ...options
    };

    // Forward playbook engine events
    this.engine.on(event => this.emit(event));

    // Register playbook_transition tool handler
    this.registerTransitionTool();
  }

  /**
   * Register the built-in playbook_transition tool
   */
  private registerTransitionTool(): void {
    // Only register if not already registered
    if (this.toolRegistry.get('playbook_transition')) return;

    this.toolRegistry.register({
      definition: PLAYBOOK_TRANSITION_TOOL,
      handler: async (params: { targetStage: string; reason: string; data?: Record<string, unknown> }) => {
        // The actual transition is handled in executeTurn after tool execution
        // This handler just validates and returns confirmation
        const playbook = this.engine.getPlaybook();
        const targetExists = playbook.stages.some(s => s.id === params.targetStage);

        if (!targetExists) {
          return {
            success: false,
            error: `Stage '${params.targetStage}' not found in playbook`
          };
        }

        return {
          success: true,
          targetStage: params.targetStage,
          reason: params.reason,
          message: `Transition to '${params.targetStage}' will be executed`
        };
      }
    });
  }

  /**
   * Get the playbook engine
   */
  getEngine(): PlaybookEngine {
    return this.engine;
  }

  /**
   * Get current conversation history
   */
  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Subscribe to orchestrator events
   */
  on(listener: OrchestratorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private async emit(event: OrchestratorEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  /**
   * Log a message
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, ...args: unknown[]): void {
    if (this.options.logger) {
      this.options.logger[level](msg, ...args);
    } else if (this.options.debug) {
      console[level](`[PlaybookOrchestrator] ${msg}`, ...args);
    }
  }

  /**
   * Build LLM request for current state
   */
  private buildLLMRequest(additionalMessages?: Message[]): LLMRequest {
    const systemPrompt = this.engine.getEffectiveSystemPrompt();
    const tools = this.engine.getAvailableTools();
    const llmConfig = this.engine.getEffectiveLLMConfig();

    const messages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      ...(additionalMessages ?? [])
    ];

    return {
      messages,
      tools: tools.length > 0 ? tools : undefined,
      toolChoice: this.engine.getCurrentStage().toolChoice,
      config: {
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        topP: llmConfig.topP
      }
    };
  }

  /**
   * Execute Phase 1: Tool loop
   * LLM can call tools repeatedly until it decides to respond
   */
  private async executePhase1(
    userMessage: string
  ): Promise<{
    toolCalls: Array<{ request: ToolCallRequest; result: ToolCallResult }>;
    llmResponses: LLMResult[];
    pendingTransition?: { targetStage: string; reason: string; data?: Record<string, unknown> };
    finalResponse?: string;
  }> {
    await this.emit({ type: 'phase1_start' });

    const allToolCalls: Array<{ request: ToolCallRequest; result: ToolCallResult }> = [];
    const llmResponses: LLMResult[] = [];
    let pendingTransition: { targetStage: string; reason: string; data?: Record<string, unknown> } | undefined;
    let iterationCount = 0;
    const startTime = Date.now();

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: userMessage });

    while (iterationCount < this.options.maxToolCallsPerTurn!) {
      // Check timeout
      if (Date.now() - startTime > this.options.phase1TimeoutMs!) {
        this.log('warn', 'Phase 1 timeout reached');
        break;
      }

      // Check abort
      if (this.options.abortSignal?.aborted) {
        throw new Error('Execution aborted');
      }

      // Call LLM
      const request = this.buildLLMRequest();
      const result = await this.llmProvider.complete(request);
      llmResponses.push(result);

      // Check if LLM wants to use tools
      if (result.stopReason === 'tool_use' && result.toolCalls?.length) {
        // Execute tool calls
        for (const toolCall of result.toolCalls) {
          await this.emit({ type: 'tool_call_start', call: toolCall });

          // Check for transition tool
          if (toolCall.name === 'playbook_transition') {
            const args = toolCall.arguments as { targetStage: string; reason: string; data?: Record<string, unknown> };
            pendingTransition = args;

            // Create a success result for the transition tool
            const transitionResult: ToolCallResult = {
              callId: toolCall.callId,
              toolName: toolCall.name,
              success: true,
              result: { message: `Transition to '${args.targetStage}' acknowledged` },
              durationMs: 0
            };

            allToolCalls.push({ request: toolCall, result: transitionResult });
            await this.emit({ type: 'tool_call_complete', call: toolCall, result: transitionResult });

            // Add tool result to history
            this.conversationHistory.push({
              role: 'assistant',
              content: result.fullText || `Using tool: ${toolCall.name}`
            });
            this.conversationHistory.push({
              role: 'tool',
              content: JSON.stringify(transitionResult.result),
              toolCallId: toolCall.callId,
              toolName: toolCall.name
            });

            // If transition is pending, we can proceed to phase 2
            // Don't continue the tool loop after transition request
            break;
          }

          // Execute regular tool
          const toolResult = await this.toolExecutor.executeSingle(toolCall, {
            sessionId: this.engine.getState().currentStage.id,
            turnId: `turn-${Date.now()}`,
            metadata: this.engine.getState().conversationContext
          });

          allToolCalls.push({ request: toolCall, result: toolResult });
          await this.emit({ type: 'tool_call_complete', call: toolCall, result: toolResult });

          // Add tool messages to history
          this.conversationHistory.push({
            role: 'assistant',
            content: result.fullText || `Using tool: ${toolCall.name}`
          });
          this.conversationHistory.push({
            role: 'tool',
            content: JSON.stringify(toolResult.result ?? toolResult.error),
            toolCallId: toolCall.callId,
            toolName: toolCall.name
          });
        }

        // If transition is pending, exit loop
        if (pendingTransition) {
          break;
        }

        iterationCount++;
      } else {
        // LLM is done with tools, has a final response
        await this.emit({ type: 'phase1_complete', toolCallCount: allToolCalls.length });

        return {
          toolCalls: allToolCalls,
          llmResponses,
          pendingTransition,
          finalResponse: result.fullText
        };
      }
    }

    await this.emit({ type: 'phase1_complete', toolCallCount: allToolCalls.length });

    return {
      toolCalls: allToolCalls,
      llmResponses,
      pendingTransition
    };
  }

  /**
   * Execute Phase 2: Generate final response
   */
  private async executePhase2(): Promise<string> {
    await this.emit({ type: 'phase2_start' });

    // Build request for final response (no tools)
    const systemPrompt = this.engine.getEffectiveSystemPrompt();
    const llmConfig = this.engine.getEffectiveLLMConfig();

    const request: LLMRequest = {
      messages: [
        { role: 'system', content: systemPrompt + '\n\nNow provide your final response to the user based on the conversation and any tool results.' },
        ...this.conversationHistory
      ],
      config: {
        temperature: llmConfig.temperature,
        maxTokens: llmConfig.maxTokens,
        topP: llmConfig.topP
      }
    };

    const result = await this.llmProvider.complete(request);
    const response = result.fullText;

    // Add assistant response to history
    this.conversationHistory.push({ role: 'assistant', content: response });

    await this.emit({ type: 'phase2_complete', response });

    return response;
  }

  /**
   * Execute a complete turn with user input
   */
  async executeTurn(userMessage: string): Promise<TurnResult> {
    const stage = this.engine.getCurrentStage();
    const useTwoPhase = stage.twoPhaseExecution !== false;

    this.log('info', `Executing turn in stage '${stage.id}' (two-phase: ${useTwoPhase})`);

    // Phase 1: Tool loop
    const phase1Result = await this.executePhase1(userMessage);

    let response: string;
    let transitioned = false;
    let transition: Transition | undefined;
    let newStage: Stage | undefined;

    // Handle pending transition
    if (phase1Result.pendingTransition) {
      const evalResult = await this.engine.evaluateExplicitTransition(
        phase1Result.pendingTransition.targetStage,
        phase1Result.pendingTransition.reason,
        phase1Result.pendingTransition.data
      );

      if (evalResult.shouldTransition && evalResult.transition) {
        transition = evalResult.transition;
        await this.emit({ type: 'transition_triggered', transition });
        await this.engine.executeTransition(transition, phase1Result.pendingTransition.data);
        transitioned = true;
        newStage = this.engine.getCurrentStage();
      }
    }

    // Check for automatic transitions based on tool calls
    if (!transitioned && phase1Result.toolCalls.length > 0) {
      const toolCallsForEval = phase1Result.toolCalls.map(tc => ({
        name: tc.request.name,
        arguments: tc.request.arguments
      }));

      const lastResponse = phase1Result.llmResponses[phase1Result.llmResponses.length - 1];
      const evalResult = await this.engine.evaluateTransitions(
        lastResponse?.fullText,
        toolCallsForEval
      );

      if (evalResult.shouldTransition && evalResult.transition) {
        transition = evalResult.transition;
        await this.emit({ type: 'transition_triggered', transition });
        await this.engine.executeTransition(transition);
        transitioned = true;
        newStage = this.engine.getCurrentStage();
      }
    }

    // Phase 2: Final response (if using two-phase and no final response from phase 1)
    if (useTwoPhase && !phase1Result.finalResponse) {
      response = await this.executePhase2();
    } else {
      response = phase1Result.finalResponse ?? '';
      // Add to history if not already added
      if (!this.conversationHistory.some(m => m.role === 'assistant' && m.content === response)) {
        this.conversationHistory.push({ role: 'assistant', content: response });
      }
    }

    // Complete turn
    await this.engine.completeTurn();

    // Check for automatic transitions based on final response
    if (!transitioned) {
      const evalResult = await this.engine.evaluateTransitions(response);
      if (evalResult.shouldTransition && evalResult.transition) {
        transition = evalResult.transition;
        await this.emit({ type: 'transition_triggered', transition });
        await this.engine.executeTransition(transition);
        transitioned = true;
        newStage = this.engine.getCurrentStage();
      }
    }

    const lastLLMResponse = phase1Result.llmResponses[phase1Result.llmResponses.length - 1];

    return {
      response,
      toolCalls: phase1Result.toolCalls,
      transitioned,
      transition,
      newStage,
      llmResponses: phase1Result.llmResponses,
      stopReason: lastLLMResponse?.stopReason
    };
  }

  /**
   * Execute a turn with streaming response
   */
  async *streamTurn(userMessage: string): AsyncIterable<{
    type: 'tool_call' | 'content' | 'done';
    data: ToolCallRequest | string | TurnResult;
  }> {
    // For streaming, we run phase 1 first, then stream phase 2
    const phase1Result = await this.executePhase1(userMessage);

    // Yield tool calls
    for (const tc of phase1Result.toolCalls) {
      yield { type: 'tool_call', data: tc.request };
    }

    // If we have a final response from phase 1, yield it
    if (phase1Result.finalResponse) {
      yield { type: 'content', data: phase1Result.finalResponse };
      this.conversationHistory.push({ role: 'assistant', content: phase1Result.finalResponse });
    } else {
      // Stream phase 2
      const systemPrompt = this.engine.getEffectiveSystemPrompt();
      const llmConfig = this.engine.getEffectiveLLMConfig();

      const request: LLMRequest = {
        messages: [
          { role: 'system', content: systemPrompt + '\n\nNow provide your final response to the user.' },
          ...this.conversationHistory
        ],
        config: {
          temperature: llmConfig.temperature,
          maxTokens: llmConfig.maxTokens,
          topP: llmConfig.topP
        }
      };

      let fullResponse = '';
      if (this.llmProvider.stream) {
        for await (const chunk of this.llmProvider.stream(request)) {
          if (chunk.content) {
            yield { type: 'content', data: chunk.content };
            fullResponse += chunk.content;
          }
        }
      } else {
        // Fall back to complete() if stream is not available
        const result = await this.llmProvider.complete(request);
        fullResponse = result.fullText;
        yield { type: 'content', data: fullResponse };
      }

      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
    }

    // Handle transitions
    let transitioned = false;
    let transition: Transition | undefined;
    let newStage: Stage | undefined;

    if (phase1Result.pendingTransition) {
      const evalResult = await this.engine.evaluateExplicitTransition(
        phase1Result.pendingTransition.targetStage,
        phase1Result.pendingTransition.reason,
        phase1Result.pendingTransition.data
      );

      if (evalResult.shouldTransition && evalResult.transition) {
        transition = evalResult.transition;
        await this.engine.executeTransition(transition, phase1Result.pendingTransition.data);
        transitioned = true;
        newStage = this.engine.getCurrentStage();
      }
    }

    await this.engine.completeTurn();

    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];

    yield {
      type: 'done',
      data: {
        response: lastMessage?.content ?? '',
        toolCalls: phase1Result.toolCalls,
        transitioned,
        transition,
        newStage,
        llmResponses: phase1Result.llmResponses,
        stopReason: phase1Result.llmResponses[phase1Result.llmResponses.length - 1]?.stopReason
      }
    };
  }

  /**
   * Reset orchestrator to initial state
   */
  reset(): void {
    this.engine.reset();
    this.conversationHistory = [];
  }
}

/**
 * Create a simple playbook with a single stage
 */
export function createSimplePlaybook(
  id: string,
  systemPrompt: string,
  tools?: ToolDefinition[]
): Playbook {
  return {
    id,
    name: id,
    stages: [{
      id: 'main',
      name: 'Main',
      systemPrompt,
      tools
    }],
    transitions: [],
    initialStage: 'main'
  };
}
