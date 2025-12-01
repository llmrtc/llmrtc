/**
 * TurnOrchestrator Interface
 *
 * Defines the common interface for orchestrators that can run voice turns.
 * Both ConversationOrchestrator and VoicePlaybookOrchestrator implement this interface.
 */

import type { VisionAttachment, OrchestratorYield } from '@metered/llmrtc-core';

/**
 * Tool call event emitted during Phase 1 (playbook mode only)
 */
export interface ToolCallStartEvent {
  type: 'tool-call-start';
  name: string;
  callId: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool call completion event (playbook mode only)
 */
export interface ToolCallEndEvent {
  type: 'tool-call-end';
  callId: string;
  result: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Stage transition event (playbook mode only)
 */
export interface StageChangeEvent {
  type: 'stage-change';
  from: string;
  to: string;
  reason: string;
}

/**
 * Extended yield type that includes tool/stage events for playbook mode
 */
export type TurnOrchestratorYield =
  | OrchestratorYield
  | ToolCallStartEvent
  | ToolCallEndEvent
  | StageChangeEvent;

/**
 * Options for running a turn
 */
export interface TurnOptions {
  /** Abort signal for cancelling the turn */
  signal?: AbortSignal;
}

/**
 * Interface for orchestrators that can process voice turns.
 * Allows LLMRTCServer to work with either simple conversation mode
 * or playbook mode with tools.
 */
export interface TurnOrchestrator {
  /**
   * Run a single voice turn: audio → STT → LLM (+ tools) → TTS
   * Yields various events as the turn progresses.
   * In playbook mode, may also yield tool-call-start, tool-call-end, and stage-change events.
   * @param audio - Audio buffer to transcribe
   * @param attachments - Optional vision attachments
   * @param options - Optional turn options including abort signal
   */
  runTurnStream(
    audio: Buffer,
    attachments?: VisionAttachment[],
    options?: TurnOptions
  ): AsyncIterable<TurnOrchestratorYield>;

  /**
   * Initialize providers (optional)
   */
  init?(): Promise<void>;
}
