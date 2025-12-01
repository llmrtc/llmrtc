/**
 * Playbook Engine
 *
 * Evaluates transition rules and manages stage transitions in a playbook.
 */

import type {
  Playbook,
  PlaybookState,
  Stage,
  Transition,
  TransitionCondition,
  TransitionContext,
  TransitionEvaluationResult,
  TransitionAction,
  StageContext
} from './playbook.js';
import { PLAYBOOK_TRANSITION_TOOL } from './playbook.js';

/**
 * Options for the playbook engine
 */
export interface PlaybookEngineOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom logger */
  logger?: {
    debug: (msg: string, ...args: unknown[]) => void;
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  };
}

/**
 * Event emitted during playbook execution
 */
export type PlaybookEvent =
  | { type: 'stage_enter'; stage: Stage; previousStage?: Stage }
  | { type: 'stage_exit'; stage: Stage; nextStage: Stage }
  | { type: 'transition'; transition: Transition; from: Stage; to: Stage }
  | { type: 'turn_complete'; stage: Stage; turnCount: number }
  | { type: 'playbook_complete'; finalStage: Stage };

/**
 * Listener for playbook events
 */
export type PlaybookEventListener = (event: PlaybookEvent) => void | Promise<void>;

/**
 * Playbook Engine - Evaluates transitions and manages playbook state
 */
export class PlaybookEngine {
  private readonly playbook: Playbook;
  private state: PlaybookState;
  private readonly options: PlaybookEngineOptions;
  private readonly listeners: Set<PlaybookEventListener> = new Set();
  private sessionMetadata: Record<string, unknown> = {};

  constructor(playbook: Playbook, options: PlaybookEngineOptions = {}) {
    this.playbook = playbook;
    this.options = options;

    // Initialize state
    const initialStage = playbook.stages.find(s => s.id === playbook.initialStage);
    if (!initialStage) {
      throw new Error(`Initial stage '${playbook.initialStage}' not found in playbook`);
    }

    this.state = {
      currentStage: initialStage,
      turnCount: 0,
      stageEnteredAt: Date.now(),
      conversationContext: {},
      transitionHistory: [],
      isComplete: false
    };
  }

  /**
   * Get current playbook state
   */
  getState(): Readonly<PlaybookState> {
    return { ...this.state };
  }

  /**
   * Get current stage
   */
  getCurrentStage(): Stage {
    return this.state.currentStage;
  }

  /**
   * Get the playbook
   */
  getPlaybook(): Playbook {
    return this.playbook;
  }

  /**
   * Set session metadata
   */
  setSessionMetadata(metadata: Record<string, unknown>): void {
    this.sessionMetadata = { ...this.sessionMetadata, ...metadata };
  }

  /**
   * Update conversation context
   */
  updateContext(updates: Record<string, unknown>): void {
    this.state.conversationContext = {
      ...this.state.conversationContext,
      ...updates
    };
  }

  /**
   * Subscribe to playbook events
   */
  on(listener: PlaybookEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private async emit(event: PlaybookEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  /**
   * Log a debug message
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, ...args: unknown[]): void {
    if (this.options.logger) {
      this.options.logger[level](msg, ...args);
    } else if (this.options.debug && level !== 'debug') {
      console[level](`[PlaybookEngine] ${msg}`, ...args);
    }
  }

  /**
   * Build transition context for evaluation
   */
  private buildTransitionContext(
    lastAssistantMessage?: string,
    lastToolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
  ): TransitionContext {
    return {
      currentStage: this.state.currentStage.id,
      turnCount: this.state.turnCount,
      timeInStage: Date.now() - this.state.stageEnteredAt,
      lastAssistantMessage,
      lastToolCalls,
      conversationContext: this.state.conversationContext,
      sessionMetadata: this.sessionMetadata
    };
  }

  /**
   * Evaluate a single transition condition
   */
  private async evaluateCondition(
    condition: TransitionCondition,
    context: TransitionContext
  ): Promise<boolean> {
    switch (condition.type) {
      case 'tool_call':
        return context.lastToolCalls?.some(tc => tc.name === condition.toolName) ?? false;

      case 'intent':
        // Intent detection would typically be done by the LLM or a classifier
        // For now, check if the intent is in the conversation context
        const detectedIntent = context.conversationContext.detectedIntent as string | undefined;
        if (!detectedIntent) return false;
        if (condition.confidence !== undefined) {
          const confidence = context.conversationContext.intentConfidence as number | undefined;
          return detectedIntent === condition.intent && (confidence ?? 0) >= condition.confidence;
        }
        return detectedIntent === condition.intent;

      case 'keyword':
        const message = context.lastAssistantMessage?.toLowerCase() ?? '';
        return condition.keywords.some(kw => message.includes(kw.toLowerCase()));

      case 'llm_decision':
        // LLM decision is handled via the playbook_transition tool
        // Check if the LLM called the transition tool
        return context.lastToolCalls?.some(tc => tc.name === 'playbook_transition') ?? false;

      case 'max_turns':
        return context.turnCount >= condition.count;

      case 'timeout':
        return context.timeInStage >= condition.durationMs;

      case 'custom':
        return await condition.evaluate(context);

      default:
        this.log('warn', `Unknown transition condition type: ${(condition as any).type}`);
        return false;
    }
  }

  /**
   * Evaluate all applicable transitions and return the highest priority match
   */
  async evaluateTransitions(
    lastAssistantMessage?: string,
    lastToolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
  ): Promise<TransitionEvaluationResult> {
    const context = this.buildTransitionContext(lastAssistantMessage, lastToolCalls);

    // Get transitions applicable to current stage (sorted by priority)
    const applicableTransitions = this.playbook.transitions
      .filter(t => t.from === '*' || t.from === this.state.currentStage.id)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const transition of applicableTransitions) {
      const matches = await this.evaluateCondition(transition.condition, context);
      if (matches) {
        this.log('debug', `Transition '${transition.id}' matched`, {
          from: this.state.currentStage.id,
          to: transition.action.targetStage,
          condition: transition.condition.type
        });

        return {
          shouldTransition: true,
          transition,
          reason: `Condition '${transition.condition.type}' matched for transition '${transition.id}'`
        };
      }
    }

    return {
      shouldTransition: false,
      reason: 'No transition conditions matched'
    };
  }

  /**
   * Check if a specific transition should be triggered (e.g., from playbook_transition tool)
   */
  async evaluateExplicitTransition(
    targetStage: string,
    reason: string,
    data?: Record<string, unknown>
  ): Promise<TransitionEvaluationResult> {
    // Verify target stage exists
    const target = this.playbook.stages.find(s => s.id === targetStage);
    if (!target) {
      return {
        shouldTransition: false,
        reason: `Target stage '${targetStage}' not found in playbook`
      };
    }

    // Find an LLM decision transition or create an implicit one
    const llmTransition = this.playbook.transitions.find(
      t => (t.from === '*' || t.from === this.state.currentStage.id) &&
           t.condition.type === 'llm_decision' &&
           t.action.targetStage === targetStage
    );

    if (llmTransition) {
      return {
        shouldTransition: true,
        transition: llmTransition,
        reason: `LLM requested transition: ${reason}`
      };
    }

    // Allow implicit LLM-initiated transitions if no explicit rule exists
    return {
      shouldTransition: true,
      transition: {
        id: `implicit_llm_${Date.now()}`,
        from: this.state.currentStage.id,
        condition: { type: 'llm_decision' },
        action: {
          targetStage,
          data
        }
      },
      reason: `LLM requested implicit transition: ${reason}`
    };
  }

  /**
   * Execute a stage transition
   */
  async executeTransition(
    transition: Transition,
    overrideData?: Record<string, unknown>
  ): Promise<void> {
    const fromStage = this.state.currentStage;
    const toStage = this.playbook.stages.find(s => s.id === transition.action.targetStage);

    if (!toStage) {
      throw new Error(`Target stage '${transition.action.targetStage}' not found`);
    }

    this.log('info', `Transitioning from '${fromStage.id}' to '${toStage.id}'`);

    // Build stage context for hooks
    const exitContext: StageContext = {
      stage: fromStage,
      otherStage: toStage,
      transitionData: overrideData ?? transition.action.data,
      sessionMetadata: this.sessionMetadata,
      conversationContext: this.state.conversationContext
    };

    // Call exit hook
    if (fromStage.onExit) {
      await fromStage.onExit(exitContext);
    }

    // Emit exit event
    await this.emit({ type: 'stage_exit', stage: fromStage, nextStage: toStage });

    // Clear history if requested
    if (transition.action.clearHistory) {
      this.state.conversationContext = {};
    }

    // Record transition in history
    this.state.transitionHistory.push({
      from: fromStage.id,
      to: toStage.id,
      transitionId: transition.id,
      timestamp: Date.now()
    });

    // Update state
    this.state.currentStage = toStage;
    this.state.turnCount = 0;
    this.state.stageEnteredAt = Date.now();

    // Merge transition data into context
    if (transition.action.data || overrideData) {
      this.state.conversationContext = {
        ...this.state.conversationContext,
        transitionData: overrideData ?? transition.action.data
      };
    }

    // Build enter context
    const enterContext: StageContext = {
      stage: toStage,
      otherStage: fromStage,
      transitionData: overrideData ?? transition.action.data,
      sessionMetadata: this.sessionMetadata,
      conversationContext: this.state.conversationContext
    };

    // Call enter hook
    if (toStage.onEnter) {
      await toStage.onEnter(enterContext);
    }

    // Emit events
    await this.emit({ type: 'transition', transition, from: fromStage, to: toStage });
    await this.emit({ type: 'stage_enter', stage: toStage, previousStage: fromStage });
  }

  /**
   * Increment turn count and emit event
   */
  async completeTurn(): Promise<void> {
    this.state.turnCount++;
    await this.emit({
      type: 'turn_complete',
      stage: this.state.currentStage,
      turnCount: this.state.turnCount
    });
  }

  /**
   * Mark playbook as complete
   */
  async complete(): Promise<void> {
    this.state.isComplete = true;
    await this.emit({
      type: 'playbook_complete',
      finalStage: this.state.currentStage
    });
  }

  /**
   * Get the effective system prompt for current stage
   * (combines global prompt with stage-specific prompt)
   */
  getEffectiveSystemPrompt(): string {
    const parts: string[] = [];

    if (this.playbook.globalSystemPrompt) {
      parts.push(this.playbook.globalSystemPrompt);
    }

    parts.push(this.state.currentStage.systemPrompt);

    // Add available transitions context for LLM
    const availableTransitions = this.playbook.transitions
      .filter(t => t.from === '*' || t.from === this.state.currentStage.id)
      .filter(t => t.condition.type === 'llm_decision');

    if (availableTransitions.length > 0) {
      const transitionDescriptions = availableTransitions.map(t => {
        const targetStage = this.playbook.stages.find(s => s.id === t.action.targetStage);
        return `- ${t.action.targetStage}: ${targetStage?.description ?? t.description ?? 'No description'}`;
      });

      parts.push(`\nYou can transition to the following stages when appropriate:\n${transitionDescriptions.join('\n')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Get all tools available in current stage
   * (combines global tools with stage-specific tools)
   */
  getAvailableTools(): import('./tools.js').ToolDefinition[] {
    const tools: import('./tools.js').ToolDefinition[] = [];

    // Add global tools
    if (this.playbook.globalTools) {
      tools.push(...this.playbook.globalTools);
    }

    // Add stage-specific tools
    if (this.state.currentStage.tools) {
      tools.push(...this.state.currentStage.tools);
    }

    // Add playbook_transition tool if LLM decision transitions exist
    const hasLLMTransitions = this.playbook.transitions.some(
      t => (t.from === '*' || t.from === this.state.currentStage.id) &&
           t.condition.type === 'llm_decision'
    );

    if (hasLLMTransitions) {
      tools.push(PLAYBOOK_TRANSITION_TOOL);
    }

    return tools;
  }

  /**
   * Get effective LLM config for current stage
   */
  getEffectiveLLMConfig(): import('./playbook.js').StageLLMConfig {
    return {
      ...this.playbook.defaultLLMConfig,
      ...this.state.currentStage.llmConfig
    };
  }

  /**
   * Reset engine to initial state
   */
  reset(): void {
    const initialStage = this.playbook.stages.find(s => s.id === this.playbook.initialStage);
    if (!initialStage) {
      throw new Error(`Initial stage '${this.playbook.initialStage}' not found`);
    }

    this.state = {
      currentStage: initialStage,
      turnCount: 0,
      stageEnteredAt: Date.now(),
      conversationContext: {},
      transitionHistory: [],
      isComplete: false
    };
    this.sessionMetadata = {};
  }
}
