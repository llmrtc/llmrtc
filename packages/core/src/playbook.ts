/**
 * Playbook Types
 *
 * Playbooks define multi-stage conversation flows with:
 * - Stages: Named conversation states with their own system prompts, tools, and config
 * - Transitions: Rules for moving between stages based on conditions
 * - Two-phase turn execution: Phase 1 (tool loop) → Phase 2 (final answer)
 */

import type { ToolDefinition, ToolChoice } from './tools.js';

/**
 * Condition for triggering a stage transition
 */
export type TransitionCondition =
  | { type: 'tool_call'; toolName: string }
  | { type: 'intent'; intent: string; confidence?: number }
  | { type: 'keyword'; keywords: string[] }
  | { type: 'llm_decision' }
  | { type: 'max_turns'; count: number }
  | { type: 'timeout'; durationMs: number }
  | { type: 'custom'; evaluate: (context: TransitionContext) => boolean | Promise<boolean> };

/**
 * Context passed to transition evaluators
 */
export interface TransitionContext {
  /** Current stage ID */
  currentStage: string;
  /** Number of turns in current stage */
  turnCount: number;
  /** Time spent in current stage (ms) */
  timeInStage: number;
  /** Last assistant message */
  lastAssistantMessage?: string;
  /** Tool calls made in last turn */
  lastToolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** Accumulated conversation context */
  conversationContext: Record<string, unknown>;
  /** Session metadata */
  sessionMetadata: Record<string, unknown>;
}

/**
 * Action to take when a transition is triggered
 */
export interface TransitionAction {
  /** Target stage to transition to */
  targetStage: string;
  /** Optional message to inject before transitioning */
  transitionMessage?: string;
  /** Whether to clear conversation history on transition */
  clearHistory?: boolean;
  /** Data to pass to the target stage */
  data?: Record<string, unknown>;
}

/**
 * A transition rule defining when and how to move between stages
 */
export interface Transition {
  /** Unique identifier for this transition */
  id: string;
  /** Human-readable description */
  description?: string;
  /** Source stage (or '*' for any stage) */
  from: string | '*';
  /** Condition that triggers this transition */
  condition: TransitionCondition;
  /** Action to take when triggered */
  action: TransitionAction;
  /** Priority for conflict resolution (higher = evaluated first) */
  priority?: number;
}

/**
 * LLM configuration overrides for a stage
 */
export interface StageLLMConfig {
  /** Temperature for this stage */
  temperature?: number;
  /** Max tokens for this stage */
  maxTokens?: number;
  /** Top-p sampling */
  topP?: number;
  /** Custom model to use for this stage (if supported) */
  model?: string;
}

/**
 * A stage in the playbook - represents a distinct conversation state
 */
export interface Stage {
  /** Unique identifier for this stage */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of this stage's purpose */
  description?: string;
  /** System prompt for this stage */
  systemPrompt: string;
  /** Tools available in this stage */
  tools?: ToolDefinition[];
  /** Tool choice mode for this stage */
  toolChoice?: ToolChoice;
  /** LLM config overrides for this stage */
  llmConfig?: StageLLMConfig;
  /** Whether this stage uses two-phase execution (default: true) */
  twoPhaseExecution?: boolean;
  /** Max turns allowed in this stage before forcing transition */
  maxTurns?: number;
  /** Timeout for this stage in milliseconds */
  timeoutMs?: number;
  /** Entry hook - called when entering this stage */
  onEnter?: (context: StageContext) => void | Promise<void>;
  /** Exit hook - called when leaving this stage */
  onExit?: (context: StageContext) => void | Promise<void>;
  /** Custom data for this stage */
  metadata?: Record<string, unknown>;
}

/**
 * Context passed to stage lifecycle hooks
 */
export interface StageContext {
  /** The stage being entered/exited */
  stage: Stage;
  /** Previous stage (on enter) or next stage (on exit) */
  otherStage?: Stage;
  /** Data passed via transition */
  transitionData?: Record<string, unknown>;
  /** Session metadata */
  sessionMetadata: Record<string, unknown>;
  /** Conversation context accumulated across stages */
  conversationContext: Record<string, unknown>;
}

/**
 * A playbook defines the complete conversation flow
 */
export interface Playbook {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this playbook does */
  description?: string;
  /** Version string */
  version?: string;
  /** All stages in this playbook */
  stages: Stage[];
  /** All transitions between stages */
  transitions: Transition[];
  /** ID of the initial stage */
  initialStage: string;
  /** Global tools available in all stages */
  globalTools?: ToolDefinition[];
  /** Global system prompt prepended to all stage prompts */
  globalSystemPrompt?: string;
  /** Default LLM config for all stages */
  defaultLLMConfig?: StageLLMConfig;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Current state of a playbook execution
 */
export interface PlaybookState {
  /** Currently active stage */
  currentStage: Stage;
  /** Number of turns in current stage */
  turnCount: number;
  /** Timestamp when current stage was entered */
  stageEnteredAt: number;
  /** Accumulated conversation context */
  conversationContext: Record<string, unknown>;
  /** History of stage transitions */
  transitionHistory: Array<{
    from: string;
    to: string;
    transitionId: string;
    timestamp: number;
  }>;
  /** Whether playbook execution is complete */
  isComplete: boolean;
}

/**
 * Result of evaluating transitions
 */
export interface TransitionEvaluationResult {
  /** Whether a transition should occur */
  shouldTransition: boolean;
  /** The matched transition (if any) */
  transition?: Transition;
  /** Reason for the decision */
  reason: string;
}

/**
 * Built-in tool for LLM-initiated stage transitions
 */
export const PLAYBOOK_TRANSITION_TOOL: ToolDefinition = {
  name: 'playbook_transition',
  description: 'Request a transition to a different conversation stage. Use this when the conversation should move to a different phase or topic that requires a different context.',
  parameters: {
    type: 'object',
    properties: {
      targetStage: {
        type: 'string',
        description: 'The ID of the stage to transition to'
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of why this transition is appropriate'
      },
      data: {
        type: 'object',
        description: 'Optional data to pass to the target stage'
      }
    },
    required: ['targetStage', 'reason']
  }
};

/**
 * Validates a playbook definition
 */
export function validatePlaybook(playbook: Playbook): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const stageIds = new Set(playbook.stages.map(s => s.id));

  // Check initial stage exists
  if (!stageIds.has(playbook.initialStage)) {
    errors.push(`Initial stage '${playbook.initialStage}' not found in stages`);
  }

  // Check for duplicate stage IDs
  const seenStageIds = new Set<string>();
  for (const stage of playbook.stages) {
    if (seenStageIds.has(stage.id)) {
      errors.push(`Duplicate stage ID: '${stage.id}'`);
    }
    seenStageIds.add(stage.id);
  }

  // Check transitions reference valid stages
  const seenTransitionIds = new Set<string>();
  for (const transition of playbook.transitions) {
    if (seenTransitionIds.has(transition.id)) {
      errors.push(`Duplicate transition ID: '${transition.id}'`);
    }
    seenTransitionIds.add(transition.id);

    if (transition.from !== '*' && !stageIds.has(transition.from)) {
      errors.push(`Transition '${transition.id}' references unknown source stage: '${transition.from}'`);
    }
    if (!stageIds.has(transition.action.targetStage)) {
      errors.push(`Transition '${transition.id}' references unknown target stage: '${transition.action.targetStage}'`);
    }
  }

  // Check for stages with no outgoing transitions (warning, not error)
  for (const stage of playbook.stages) {
    const hasOutgoing = playbook.transitions.some(
      t => t.from === stage.id || t.from === '*'
    );
    if (!hasOutgoing && playbook.stages.length > 1) {
      // This is a terminal stage - acceptable but worth noting
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Creates a new playbook state for a given playbook
 */
export function createPlaybookState(playbook: Playbook): PlaybookState {
  const initialStage = playbook.stages.find(s => s.id === playbook.initialStage);
  if (!initialStage) {
    throw new Error(`Initial stage '${playbook.initialStage}' not found`);
  }

  return {
    currentStage: initialStage,
    turnCount: 0,
    stageEnteredAt: Date.now(),
    conversationContext: {},
    transitionHistory: [],
    isComplete: false
  };
}
