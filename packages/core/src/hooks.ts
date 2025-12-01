/**
 * Hook interfaces for observability and extensibility
 *
 * These hooks allow integrators to:
 * - Capture timing/latency metrics for STT, LLM, and TTS operations
 * - Plug in custom logging or metrics reporters
 * - Add guardrails, validation, or routing logic without forking
 */

import type {
  STTResult,
  LLMRequest,
  LLMChunk,
  LLMResult,
  TTSChunk
} from './types.js';
import type { ErrorCode } from './protocol.js';
import type { ToolCallRequest, ToolCallResult } from './tools.js';
import type { Stage, Transition } from './playbook.js';

// =============================================================================
// Context Types
// =============================================================================

/**
 * Context for a single conversation turn
 * Passed to all hooks within a turn
 */
export interface TurnContext {
  /** Unique identifier for this turn */
  turnId: string;
  /** Optional session identifier */
  sessionId?: string;
  /** Timestamp when the turn started (Date.now()) */
  startTime: number;
}

/**
 * Timing information for completed operations
 */
export interface TimingInfo {
  /** Timestamp when operation started (Date.now()) */
  startTime: number;
  /** Timestamp when operation ended (Date.now()) */
  endTime: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Context for error hooks
 */
export interface ErrorContext {
  /** Structured error code */
  code: ErrorCode;
  /** Component that produced the error */
  component: 'stt' | 'llm' | 'tts' | 'vad' | 'webrtc' | 'server' | 'tool' | 'playbook';
  /** Session identifier if available */
  sessionId?: string;
  /** Turn identifier if available */
  turnId?: string;
  /** Timestamp when error occurred (Date.now()) */
  timestamp: number;
  /** Additional error details */
  details?: Record<string, unknown>;
}

// =============================================================================
// Orchestrator Hooks
// =============================================================================

/**
 * Hooks for the ConversationOrchestrator
 *
 * These hooks are called during the STT → LLM → TTS pipeline.
 * All hooks are optional and can be sync or async.
 *
 * @example
 * ```typescript
 * const orchestrator = new ConversationOrchestrator({
 *   providers: { llm, stt, tts },
 *   hooks: {
 *     onTurnStart(ctx) {
 *       console.log(`Turn ${ctx.turnId} started`);
 *     },
 *     onSTTEnd(ctx, result, timing) {
 *       console.log(`STT: "${result.text}" in ${timing.durationMs}ms`);
 *     },
 *     onLLMEnd(ctx, result, timing) {
 *       // Guardrail: check for inappropriate content
 *       if (result.fullText.includes('forbidden')) {
 *         throw new Error('Content policy violation');
 *       }
 *     }
 *   }
 * });
 * ```
 */
export interface OrchestratorHooks {
  // ---------------------------------------------------------------------------
  // Turn Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called when a conversation turn starts
   * @param ctx - Turn context with turnId and startTime
   * @param audio - Input audio buffer to be transcribed
   */
  onTurnStart?(ctx: TurnContext, audio: Buffer): void | Promise<void>;

  /**
   * Called when a conversation turn completes
   * @param ctx - Turn context
   * @param timing - Total turn duration
   */
  onTurnEnd?(ctx: TurnContext, timing: TimingInfo): void | Promise<void>;

  // ---------------------------------------------------------------------------
  // STT Hooks
  // ---------------------------------------------------------------------------

  /**
   * Called before STT transcription begins
   * @param ctx - Turn context
   * @param audio - Audio buffer being transcribed
   */
  onSTTStart?(ctx: TurnContext, audio: Buffer): void | Promise<void>;

  /**
   * Called when STT transcription completes successfully
   * @param ctx - Turn context
   * @param result - Transcription result
   * @param timing - STT operation duration
   */
  onSTTEnd?(ctx: TurnContext, result: STTResult, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when STT transcription fails
   * @param ctx - Turn context
   * @param error - Error that occurred
   */
  onSTTError?(ctx: TurnContext, error: Error): void | Promise<void>;

  // ---------------------------------------------------------------------------
  // LLM Hooks
  // ---------------------------------------------------------------------------

  /**
   * Called before LLM inference begins
   * @param ctx - Turn context
   * @param request - LLM request with messages and config
   */
  onLLMStart?(ctx: TurnContext, request: LLMRequest): void | Promise<void>;

  /**
   * Called for each LLM streaming chunk
   * @param ctx - Turn context
   * @param chunk - LLM response chunk
   * @param chunkIndex - Zero-based index of this chunk
   */
  onLLMChunk?(ctx: TurnContext, chunk: LLMChunk, chunkIndex: number): void | Promise<void>;

  /**
   * Called when LLM inference completes successfully
   * Use this hook for content guardrails - throw an error to cancel the response
   * @param ctx - Turn context
   * @param result - Complete LLM response
   * @param timing - LLM operation duration
   */
  onLLMEnd?(ctx: TurnContext, result: LLMResult, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when LLM inference fails
   * @param ctx - Turn context
   * @param error - Error that occurred
   */
  onLLMError?(ctx: TurnContext, error: Error): void | Promise<void>;

  // ---------------------------------------------------------------------------
  // TTS Hooks
  // ---------------------------------------------------------------------------

  /**
   * Called before TTS synthesis begins for a sentence/text
   * @param ctx - Turn context
   * @param text - Text being synthesized
   */
  onTTSStart?(ctx: TurnContext, text: string): void | Promise<void>;

  /**
   * Called for each TTS audio chunk during streaming
   * @param ctx - Turn context
   * @param chunk - TTS audio chunk
   * @param chunkIndex - Zero-based index of this chunk
   */
  onTTSChunk?(ctx: TurnContext, chunk: TTSChunk, chunkIndex: number): void | Promise<void>;

  /**
   * Called when all TTS synthesis completes for the turn
   * @param ctx - Turn context
   * @param timing - Total TTS operation duration
   */
  onTTSEnd?(ctx: TurnContext, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when TTS synthesis fails
   * @param ctx - Turn context
   * @param error - Error that occurred
   */
  onTTSError?(ctx: TurnContext, error: Error): void | Promise<void>;

  // ---------------------------------------------------------------------------
  // Tool Hooks
  // ---------------------------------------------------------------------------

  /**
   * Called before a tool is executed
   * @param ctx - Turn context
   * @param request - Tool call request with name and arguments
   */
  onToolStart?(ctx: TurnContext, request: ToolCallRequest): void | Promise<void>;

  /**
   * Called when a tool execution completes
   * Use this hook to log tool results or add guardrails
   * @param ctx - Turn context
   * @param result - Tool execution result
   * @param timing - Tool execution duration
   */
  onToolEnd?(ctx: TurnContext, result: ToolCallResult, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when a tool execution fails
   * @param ctx - Turn context
   * @param request - The tool call that failed
   * @param error - Error that occurred
   */
  onToolError?(ctx: TurnContext, request: ToolCallRequest, error: Error): void | Promise<void>;
}

// =============================================================================
// Server Hooks
// =============================================================================

/**
 * Hooks for the LLMRTCServer
 *
 * These hooks are called for server-level events like connections,
 * disconnections, and speech detection.
 *
 * @example
 * ```typescript
 * const server = new LLMRTCServer({
 *   providers: { llm, stt, tts },
 *   hooks: {
 *     onConnection(sessionId, connectionId) {
 *       console.log(`Client ${connectionId} connected to session ${sessionId}`);
 *     },
 *     onDisconnect(sessionId, timing) {
 *       console.log(`Session ${sessionId} ended after ${timing.durationMs}ms`);
 *     },
 *     onError(error, context) {
 *       reportToSentry(error, context);
 *     }
 *   }
 * });
 * ```
 */
export interface ServerHooks {
  /**
   * Called when a new WebSocket connection is established
   * @param sessionId - Session identifier
   * @param connectionId - Connection identifier (for reconnection tracking)
   */
  onConnection?(sessionId: string, connectionId: string): void | Promise<void>;

  /**
   * Called when a WebSocket connection closes
   * @param sessionId - Session identifier
   * @param timing - Session duration from connection to disconnect
   */
  onDisconnect?(sessionId: string, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when VAD detects speech start
   * @param sessionId - Session identifier
   * @param timestamp - Timestamp when speech started (Date.now())
   */
  onSpeechStart?(sessionId: string, timestamp: number): void | Promise<void>;

  /**
   * Called when VAD detects speech end
   * @param sessionId - Session identifier
   * @param timestamp - Timestamp when speech ended (Date.now())
   * @param audioDurationMs - Duration of the speech audio in milliseconds
   */
  onSpeechEnd?(sessionId: string, timestamp: number, audioDurationMs: number): void | Promise<void>;

  /**
   * Called when any error occurs
   * Use this hook for centralized error reporting
   * @param error - The error that occurred
   * @param context - Error context with component, session, turn info
   */
  onError?(error: Error, context: ErrorContext): void | Promise<void>;
}

// =============================================================================
// Playbook Hooks
// =============================================================================

/**
 * Context for playbook hooks
 */
export interface PlaybookContext {
  /** Playbook ID */
  playbookId: string;
  /** Current stage ID */
  stageId: string;
  /** Session ID if available */
  sessionId?: string;
  /** Number of turns in current stage */
  turnCount: number;
  /** Time spent in current stage (ms) */
  timeInStage: number;
}

/**
 * Hooks for playbook execution
 *
 * These hooks are called during playbook stage transitions
 * and can be used for logging, analytics, or custom behavior.
 *
 * @example
 * ```typescript
 * const orchestrator = new PlaybookOrchestrator({
 *   llm,
 *   playbook,
 *   hooks: {
 *     onStageEnter(ctx, stage) {
 *       console.log(`Entered stage: ${stage.name}`);
 *       analytics.track('stage_entered', { stage: stage.id });
 *     },
 *     onTransition(ctx, transition, from, to) {
 *       console.log(`Transitioned: ${from.id} -> ${to.id}`);
 *     }
 *   }
 * });
 * ```
 */
export interface PlaybookHooks {
  /**
   * Called when entering a new stage
   * @param ctx - Playbook context
   * @param stage - The stage being entered
   * @param previousStage - The previous stage (undefined if initial)
   */
  onStageEnter?(ctx: PlaybookContext, stage: Stage, previousStage?: Stage): void | Promise<void>;

  /**
   * Called when exiting a stage
   * @param ctx - Playbook context
   * @param stage - The stage being exited
   * @param nextStage - The stage being transitioned to
   * @param timing - Time spent in the exited stage
   */
  onStageExit?(ctx: PlaybookContext, stage: Stage, nextStage: Stage, timing: TimingInfo): void | Promise<void>;

  /**
   * Called when a stage transition occurs
   * @param ctx - Playbook context
   * @param transition - The transition that was triggered
   * @param from - Source stage
   * @param to - Target stage
   */
  onTransition?(ctx: PlaybookContext, transition: Transition, from: Stage, to: Stage): void | Promise<void>;

  /**
   * Called when a playbook turn completes
   * @param ctx - Playbook context
   * @param response - The assistant's response
   * @param toolCallCount - Number of tool calls made in this turn
   */
  onPlaybookTurnEnd?(ctx: PlaybookContext, response: string, toolCallCount: number): void | Promise<void>;

  /**
   * Called when playbook execution completes
   * @param ctx - Playbook context
   * @param finalStage - The stage where execution ended
   * @param totalTurns - Total turns across all stages
   */
  onPlaybookComplete?(ctx: PlaybookContext, finalStage: Stage, totalTurns: number): void | Promise<void>;
}

// =============================================================================
// Combined Hooks
// =============================================================================

/**
 * Combined hooks interface for convenience
 * Can be used when you want a single hooks object for server, orchestrator, and playbook
 */
export interface CombinedHooks extends OrchestratorHooks, ServerHooks, PlaybookHooks {}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create timing info from start and end timestamps
 */
export function createTimingInfo(startTime: number, endTime: number): TimingInfo {
  return {
    startTime,
    endTime,
    durationMs: endTime - startTime
  };
}

/**
 * Create an error context object
 */
export function createErrorContext(
  code: ErrorCode,
  component: ErrorContext['component'],
  options?: {
    sessionId?: string;
    turnId?: string;
    details?: Record<string, unknown>;
  }
): ErrorContext {
  return {
    code,
    component,
    sessionId: options?.sessionId,
    turnId: options?.turnId,
    timestamp: Date.now(),
    details: options?.details
  };
}

/**
 * Safely call an async hook without blocking
 * Errors are caught and logged but don't propagate
 * @param hook - The hook function to call
 * @param args - Arguments to pass to the hook
 */
export async function callHookSafe<T extends unknown[]>(
  hook: ((...args: T) => void | Promise<void>) | undefined,
  ...args: T
): Promise<void> {
  if (!hook) return;
  try {
    await hook(...args);
  } catch (error) {
    // Log but don't propagate hook errors
    console.error('[hooks] Hook error:', error);
  }
}
