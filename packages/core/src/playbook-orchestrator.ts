/**
 * Playbook Orchestrator
 *
 * Orchestrates turn execution with two-phase model:
 * - Phase 1: Tool loop - LLM can call tools repeatedly until it decides to respond
 * - Phase 2: Final answer - Generate the user-facing response
 *
 * Integrates with STT/TTS for voice-based interactions.
 */

import type { LLMProvider, LLMRequest, LLMResult, Message, VisionAttachment } from './types.js';
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
  /** Number of LLM retry attempts on failure (default: 3) */
  llmRetries?: number;
  /** Maximum conversation history messages to retain (default: 50) */
  historyLimit?: number;
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

  // Concurrency protection: serialize turn execution to prevent history corruption
  private turnLock: Promise<void> = Promise.resolve();
  private isExecutingTurn = false;

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
      llmRetries: 3,
      historyLimit: 50,
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
   * Add message to history with automatic cleanup when limit exceeded.
   * Uses smart trimming to preserve tool call/result pairs (required by OpenAI API).
   */
  private pushHistory(message: Message): void {
    this.conversationHistory.push(message);
    const limit = this.options.historyLimit ?? 50;

    if (this.conversationHistory.length > limit) {
      const overflow = this.conversationHistory.length - limit;
      let trimPoint = overflow;

      // Find a safe trim point that doesn't split tool call/result pairs
      // We scan forward from the naive trim point to find a safe boundary
      while (trimPoint < this.conversationHistory.length) {
        const msgAtTrim = this.conversationHistory[trimPoint];

        // Can't trim here if it's a tool result (would orphan it)
        if (msgAtTrim.role === 'tool') {
          trimPoint++;
          continue;
        }

        // Can't trim if the previous message is assistant with toolCalls
        // (would orphan the following tool results)
        if (trimPoint > 0) {
          const prevMsg = this.conversationHistory[trimPoint - 1];
          if (prevMsg.role === 'assistant' && prevMsg.toolCalls?.length) {
            trimPoint++;
            continue;
          }
        }

        // Found a safe boundary
        break;
      }

      // Only trim if we found a safe point within the history
      if (trimPoint > 0 && trimPoint < this.conversationHistory.length) {
        this.conversationHistory.splice(0, trimPoint);
        this.log('debug', `Trimmed ${trimPoint} messages from history (limit: ${limit})`);
      }
    }
  }

  /**
   * Check if an error is retryable.
   * Non-retryable: client errors (400, 401, 403, 404) except rate limits.
   * Retryable: rate limits (429), server errors (5xx), timeouts.
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Non-retryable: client errors (except rate limit)
    if (message.includes('400') || message.includes('bad request')) return false;
    if (message.includes('401') || message.includes('unauthorized')) return false;
    if (message.includes('403') || message.includes('forbidden')) return false;
    if (message.includes('404') || message.includes('not found')) return false;

    // Retryable: rate limits, server errors, timeouts
    if (message.includes('429') || message.includes('rate limit')) return true;
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) return true;
    if (message.includes('timeout') || message.includes('etimedout') || message.includes('econnreset')) return true;

    // Default: retry unknown errors (could be transient network issues)
    return true;
  }

  /**
   * Call LLM with smart retry and exponential backoff.
   * Only retries on retryable errors (rate limits, server errors, timeouts).
   */
  private async callLLMWithRetry(request: LLMRequest): Promise<LLMResult> {
    const maxRetries = this.options.llmRetries ?? 3;
    let lastError: Error = new Error('No attempts made');

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check for abort
      if (this.options.abortSignal?.aborted) {
        throw new Error('LLM call aborted');
      }

      try {
        return await this.llmProvider.complete(request);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log('warn', `LLM call failed (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`);

        // Don't retry non-retryable errors
        if (!this.isRetryableError(lastError)) {
          this.log('error', `Non-retryable error, aborting retries`);
          throw lastError;
        }

        // Don't retry on last attempt
        if (attempt < maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          this.log('debug', `Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.log('error', `LLM call failed after ${maxRetries} attempts`);
    throw lastError;
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
    userMessage: string,
    attachments?: VisionAttachment[]
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

    // Add user message to history (with optional attachments for vision)
    const userMsg: Message = { role: 'user', content: userMessage };
    if (attachments && attachments.length > 0) {
      userMsg.attachments = attachments;
    }
    this.pushHistory(userMsg);

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

      // Call LLM with retry
      const request = this.buildLLMRequest();
      const result = await this.callLLMWithRetry(request);
      llmResponses.push(result);

      // Check if LLM wants to use tools
      if (result.stopReason === 'tool_use' && result.toolCalls?.length) {
        // Valid tool_use with actual tool calls
        // Add assistant message with ALL tool calls BEFORE executing them
        // This is required by OpenAI API - tool messages must follow an assistant message with tool_calls
        this.pushHistory({
          role: 'assistant',
          content: result.fullText || '',
          toolCalls: result.toolCalls
        });

        // Execute tool calls and add tool result messages
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
            this.pushHistory({
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

          // Add tool result to history
          this.pushHistory({
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
      } else if (result.stopReason === 'tool_use' && (!result.toolCalls || result.toolCalls.length === 0)) {
        // Edge case: LLM indicated tool_use but provided no tool calls
        // This can happen with some models/edge cases - treat as done
        this.log('warn', 'LLM returned tool_use stop reason but no tool calls were provided');
        await this.emit({ type: 'phase1_complete', toolCallCount: allToolCalls.length });

        return {
          toolCalls: allToolCalls,
          llmResponses,
          pendingTransition,
          finalResponse: result.fullText
        };
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

    const result = await this.callLLMWithRetry(request);
    const response = result.fullText;

    // Add assistant response to history
    this.pushHistory({ role: 'assistant', content: response });

    await this.emit({ type: 'phase2_complete', response });

    return response;
  }

  /**
   * Execute a complete turn with user input.
   * This method is serialized - concurrent calls will be queued.
   * @param userMessage - The user's message text
   * @param attachments - Optional vision attachments (images)
   */
  async executeTurn(userMessage: string, attachments?: VisionAttachment[]): Promise<TurnResult> {
    // Wait for any pending turn to complete
    await this.turnLock;

    // Create new lock for this turn
    let releaseLock!: () => void;
    this.turnLock = new Promise(resolve => { releaseLock = resolve; });
    this.isExecutingTurn = true;

    try {
      return await this._executeTurnInternal(userMessage, attachments);
    } finally {
      this.isExecutingTurn = false;
      releaseLock();
    }
  }

  /**
   * Internal turn execution logic
   */
  private async _executeTurnInternal(userMessage: string, attachments?: VisionAttachment[]): Promise<TurnResult> {
    const stage = this.engine.getCurrentStage();
    const useTwoPhase = stage.twoPhaseExecution !== false;

    this.log('info', `Executing turn in stage '${stage.id}' (two-phase: ${useTwoPhase})`);

    // Phase 1: Tool loop
    const phase1Result = await this.executePhase1(userMessage, attachments);

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
        this.pushHistory({ role: 'assistant', content: response });
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
   * Execute a turn with streaming response.
   * This method is serialized - concurrent calls will be queued.
   * @param userMessage - The user's message text
   * @param attachments - Optional vision attachments (images)
   */
  async *streamTurn(userMessage: string, attachments?: VisionAttachment[]): AsyncIterable<{
    type: 'tool_call' | 'content' | 'done';
    data: ToolCallRequest | string | TurnResult;
  }> {
    // Wait for any pending turn to complete
    await this.turnLock;

    // Create new lock for this turn
    let releaseLock!: () => void;
    this.turnLock = new Promise(resolve => { releaseLock = resolve; });
    this.isExecutingTurn = true;

    try {
      // Yield from internal implementation
      yield* this._streamTurnInternal(userMessage, attachments);
    } finally {
      this.isExecutingTurn = false;
      releaseLock();
    }
  }

  /**
   * Internal streaming turn logic
   */
  private async *_streamTurnInternal(userMessage: string, attachments?: VisionAttachment[]): AsyncIterable<{
    type: 'tool_call' | 'content' | 'done';
    data: ToolCallRequest | string | TurnResult;
  }> {
    // For streaming, we run phase 1 first, then stream phase 2
    const phase1Result = await this.executePhase1(userMessage, attachments);

    // Yield tool calls
    for (const tc of phase1Result.toolCalls) {
      yield { type: 'tool_call', data: tc.request };
    }

    // Track full response for transition evaluation
    let fullResponse = '';

    // If we have a final response from phase 1, yield it
    if (phase1Result.finalResponse) {
      fullResponse = phase1Result.finalResponse;
      yield { type: 'content', data: phase1Result.finalResponse };
      this.pushHistory({ role: 'assistant', content: phase1Result.finalResponse });
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

      if (this.llmProvider.stream) {
        for await (const chunk of this.llmProvider.stream(request)) {
          if (chunk.content) {
            yield { type: 'content', data: chunk.content };
            fullResponse += chunk.content;
          }
        }
      } else {
        // Fall back to complete() with retry if stream is not available
        const result = await this.callLLMWithRetry(request);
        fullResponse = result.fullText;
        yield { type: 'content', data: fullResponse };
      }

      this.pushHistory({ role: 'assistant', content: fullResponse });
    }

    // Handle transitions
    let transitioned = false;
    let transition: Transition | undefined;
    let newStage: Stage | undefined;

    // 1. Handle pending transition from playbook_transition tool
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

    // 2. Check for automatic transitions based on tool calls
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

    // Complete turn
    await this.engine.completeTurn();

    // 3. Check for automatic transitions based on final response (keyword, etc.)
    if (!transitioned) {
      const evalResult = await this.engine.evaluateTransitions(fullResponse);
      if (evalResult.shouldTransition && evalResult.transition) {
        transition = evalResult.transition;
        await this.emit({ type: 'transition_triggered', transition });
        await this.engine.executeTransition(transition);
        transitioned = true;
        newStage = this.engine.getCurrentStage();
      }
    }

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
