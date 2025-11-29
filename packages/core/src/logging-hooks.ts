/**
 * Pre-built logging hooks for structured logging
 *
 * This module provides ready-to-use hooks that log all orchestrator and server
 * events with structured timing information.
 *
 * @example
 * ```typescript
 * import { LLMRTCServer, createLoggingHooks } from '@metered/llmrtc-backend';
 *
 * const server = new LLMRTCServer({
 *   providers: { llm, stt, tts },
 *   hooks: createLoggingHooks({ level: 'info' })
 * });
 *
 * // Output:
 * // [llmrtc] Connection established: session=abc123
 * // [llmrtc] Turn started: turn=xyz789 session=abc123
 * // [llmrtc] STT completed: turn=xyz789 duration=142ms text="Hello there"
 * // [llmrtc] LLM started: turn=xyz789
 * // [llmrtc] LLM completed: turn=xyz789 duration=312ms
 * // [llmrtc] TTS completed: turn=xyz789 duration=89ms
 * // [llmrtc] Turn completed: turn=xyz789 duration=543ms
 * ```
 */

import type { OrchestratorHooks, ServerHooks, TurnContext, TimingInfo, ErrorContext } from './hooks.js';
import type { STTResult, LLMRequest, LLMChunk, LLMResult, TTSChunk } from './types.js';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Log levels in order of verbosity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface compatible with console
 */
export interface LoggerLike {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Configuration for createLoggingHooks
 */
export interface LoggingHooksConfig {
  /**
   * Custom logger instance (default: console)
   * Must implement debug, info, log, warn, error methods
   */
  logger?: LoggerLike;

  /**
   * Minimum log level (default: 'info')
   * - 'debug': Log everything including chunk details
   * - 'info': Log turn lifecycle and timing
   * - 'warn': Log warnings and errors only
   * - 'error': Log errors only
   */
  level?: LogLevel;

  /**
   * Include payloads in logs (default: false)
   * When true, includes STT text, LLM request/response content, etc.
   * Warning: May log sensitive data
   */
  includePayloads?: boolean;

  /**
   * Log prefix (default: '[llmrtc]')
   */
  prefix?: string;

  /**
   * Include timestamps in logs (default: true)
   */
  includeTimestamp?: boolean;
}

// =============================================================================
// Log Level Utilities
// =============================================================================

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function shouldLog(configLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[messageLevel] >= LOG_LEVEL_ORDER[configLevel];
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a set of logging hooks for structured logging
 *
 * @param config - Configuration options
 * @returns Combined OrchestratorHooks and ServerHooks
 *
 * @example
 * ```typescript
 * // Basic usage with console logging
 * const hooks = createLoggingHooks();
 *
 * // Custom logger and level
 * const hooks = createLoggingHooks({
 *   logger: pino(),
 *   level: 'debug',
 *   includePayloads: true
 * });
 *
 * // Use with LLMRTCServer
 * const server = new LLMRTCServer({
 *   providers: { llm, stt, tts },
 *   hooks: {
 *     ...createLoggingHooks({ level: 'info' }),
 *     // Add custom hook
 *     onLLMEnd(ctx, result) {
 *       // Custom guardrail
 *       if (result.fullText.includes('forbidden')) {
 *         throw new Error('Content policy violation');
 *       }
 *     }
 *   }
 * });
 * ```
 */
export function createLoggingHooks(
  config: LoggingHooksConfig = {}
): OrchestratorHooks & ServerHooks {
  const {
    logger = console,
    level = 'info',
    includePayloads = false,
    prefix = '[llmrtc]',
    includeTimestamp = true
  } = config;

  const formatLog = (message: string, data?: Record<string, unknown>): string => {
    const timestamp = includeTimestamp ? new Date().toISOString() + ' ' : '';
    const dataStr = data ? ' ' + Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ') : '';
    return `${timestamp}${prefix} ${message}${dataStr}`;
  };

  const log = (messageLevel: LogLevel, message: string, data?: Record<string, unknown>) => {
    if (!shouldLog(level, messageLevel)) return;

    const formatted = formatLog(message, data);
    switch (messageLevel) {
      case 'debug':
        logger.debug(formatted);
        break;
      case 'info':
        logger.info ? logger.info(formatted) : logger.log(formatted);
        break;
      case 'warn':
        logger.warn(formatted);
        break;
      case 'error':
        logger.error(formatted);
        break;
    }
  };

  return {
    // =========================================================================
    // Server Hooks
    // =========================================================================

    onConnection(sessionId: string, connectionId: string) {
      log('info', 'Connection established', { session: sessionId, connection: connectionId });
    },

    onDisconnect(sessionId: string, timing: TimingInfo) {
      log('info', 'Connection closed', {
        session: sessionId,
        duration: `${timing.durationMs}ms`
      });
    },

    onSpeechStart(sessionId: string, timestamp: number) {
      log('debug', 'Speech started', { session: sessionId, timestamp });
    },

    onSpeechEnd(sessionId: string, timestamp: number, audioDurationMs: number) {
      log('debug', 'Speech ended', {
        session: sessionId,
        audioDuration: `${audioDurationMs}ms`
      });
    },

    onError(error: Error, context: ErrorContext) {
      log('error', `Error in ${context.component}`, {
        code: context.code,
        message: error.message,
        session: context.sessionId,
        turn: context.turnId
      });
    },

    // =========================================================================
    // Turn Lifecycle Hooks
    // =========================================================================

    onTurnStart(ctx: TurnContext, audio: Buffer) {
      log('info', 'Turn started', {
        turn: ctx.turnId,
        session: ctx.sessionId,
        audioSize: `${audio.length}b`
      });
    },

    onTurnEnd(ctx: TurnContext, timing: TimingInfo) {
      log('info', 'Turn completed', {
        turn: ctx.turnId,
        duration: `${timing.durationMs}ms`
      });
    },

    // =========================================================================
    // STT Hooks
    // =========================================================================

    onSTTStart(ctx: TurnContext, audio: Buffer) {
      log('debug', 'STT started', {
        turn: ctx.turnId,
        audioSize: `${audio.length}b`
      });
    },

    onSTTEnd(ctx: TurnContext, result: STTResult, timing: TimingInfo) {
      const data: Record<string, unknown> = {
        turn: ctx.turnId,
        duration: `${timing.durationMs}ms`
      };
      if (includePayloads) {
        data.text = result.text;
      }
      log('info', 'STT completed', data);
    },

    onSTTError(ctx: TurnContext, error: Error) {
      log('error', 'STT failed', {
        turn: ctx.turnId,
        error: error.message
      });
    },

    // =========================================================================
    // LLM Hooks
    // =========================================================================

    onLLMStart(ctx: TurnContext, request: LLMRequest) {
      const data: Record<string, unknown> = {
        turn: ctx.turnId,
        messages: request.messages.length
      };
      if (includePayloads && request.messages.length > 0) {
        const lastMsg = request.messages[request.messages.length - 1];
        data.lastMessage = lastMsg.content.slice(0, 100);
      }
      log('debug', 'LLM started', data);
    },

    onLLMChunk(ctx: TurnContext, chunk: LLMChunk, chunkIndex: number) {
      if (chunkIndex === 0) {
        log('debug', 'LLM first chunk received', { turn: ctx.turnId });
      }
    },

    onLLMEnd(ctx: TurnContext, result: LLMResult, timing: TimingInfo) {
      const data: Record<string, unknown> = {
        turn: ctx.turnId,
        duration: `${timing.durationMs}ms`,
        chars: result.fullText.length
      };
      if (includePayloads) {
        data.response = result.fullText.slice(0, 200);
      }
      log('info', 'LLM completed', data);
    },

    onLLMError(ctx: TurnContext, error: Error) {
      log('error', 'LLM failed', {
        turn: ctx.turnId,
        error: error.message
      });
    },

    // =========================================================================
    // TTS Hooks
    // =========================================================================

    onTTSStart(ctx: TurnContext, text: string) {
      const data: Record<string, unknown> = {
        turn: ctx.turnId,
        textLength: text.length
      };
      if (includePayloads) {
        data.text = text.slice(0, 100);
      }
      log('debug', 'TTS started', data);
    },

    onTTSChunk(ctx: TurnContext, chunk: TTSChunk, chunkIndex: number) {
      log('debug', 'TTS chunk', {
        turn: ctx.turnId,
        chunk: chunkIndex,
        size: `${chunk.audio.length}b`
      });
    },

    onTTSEnd(ctx: TurnContext, timing: TimingInfo) {
      log('info', 'TTS completed', {
        turn: ctx.turnId,
        duration: `${timing.durationMs}ms`
      });
    },

    onTTSError(ctx: TurnContext, error: Error) {
      log('error', 'TTS failed', {
        turn: ctx.turnId,
        error: error.message
      });
    }
  };
}

// =============================================================================
// Specialized Loggers
// =============================================================================

/**
 * Create a minimal logging hook that only logs errors
 */
export function createErrorOnlyHooks(
  config: Omit<LoggingHooksConfig, 'level'> = {}
): OrchestratorHooks & ServerHooks {
  return createLoggingHooks({ ...config, level: 'error' });
}

/**
 * Create a verbose logging hook that logs everything including chunks
 */
export function createVerboseHooks(
  config: Omit<LoggingHooksConfig, 'level' | 'includePayloads'> = {}
): OrchestratorHooks & ServerHooks {
  return createLoggingHooks({ ...config, level: 'debug', includePayloads: true });
}

/**
 * Create timing-only hooks that just emit timing metrics without logging
 * Useful when you want metrics without log noise
 */
export function createTimingHooks(): Pick<
  OrchestratorHooks,
  'onSTTEnd' | 'onLLMEnd' | 'onTTSEnd' | 'onTurnEnd'
> {
  return {
    onSTTEnd(_ctx, _result, timing) {
      // Just track timing, no logging
      void timing;
    },
    onLLMEnd(_ctx, _result, timing) {
      void timing;
    },
    onTTSEnd(_ctx, timing) {
      void timing;
    },
    onTurnEnd(_ctx, timing) {
      void timing;
    }
  };
}
