/**
 * Tool Executor
 *
 * Handles execution of tool calls from LLM responses.
 * Supports sequential and parallel execution policies.
 */

import {
  Tool,
  ToolCallRequest,
  ToolCallResult,
  ToolExecutionContext,
  ToolRegistry,
  validateToolArguments,
} from './tools.js';

// =============================================================================
// Executor Options
// =============================================================================

/**
 * Options for tool execution
 */
export interface ToolExecutorOptions {
  /** Default execution policy when not specified on tool (default: 'parallel') */
  defaultPolicy?: 'sequential' | 'parallel';
  /** Maximum concurrent tool executions (default: 10) */
  maxConcurrency?: number;
  /** Timeout per tool execution in ms (default: 30000) */
  timeout?: number;
  /** Validate tool arguments against schema before execution (default: false) */
  validateArguments?: boolean;
  /** Handler called when a tool execution starts */
  onToolStart?: (toolName: string, callId: string, args: Record<string, unknown>) => void;
  /** Handler called when a tool execution completes */
  onToolEnd?: (result: ToolCallResult) => void;
  /** Handler called when a tool execution fails */
  onToolError?: (toolName: string, callId: string, error: Error) => void;
}

// =============================================================================
// Tool Executor
// =============================================================================

/**
 * Executes tool calls from LLM responses
 * Handles both sequential and parallel execution based on tool policies
 */
export class ToolExecutor {
  private registry: ToolRegistry;
  private options: Required<Omit<ToolExecutorOptions, 'onToolStart' | 'onToolEnd' | 'onToolError'>> &
    Pick<ToolExecutorOptions, 'onToolStart' | 'onToolEnd' | 'onToolError'>;

  constructor(registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.registry = registry;
    this.options = {
      defaultPolicy: options.defaultPolicy ?? 'parallel',
      maxConcurrency: options.maxConcurrency ?? 10,
      timeout: options.timeout ?? 30000,
      validateArguments: options.validateArguments ?? false,
      onToolStart: options.onToolStart,
      onToolEnd: options.onToolEnd,
      onToolError: options.onToolError,
    };
  }

  /**
   * Execute a batch of tool calls
   * Respects individual tool execution policies
   */
  async execute(
    calls: ToolCallRequest[],
    context: Omit<ToolExecutionContext, 'callId'>
  ): Promise<ToolCallResult[]> {
    if (calls.length === 0) {
      return [];
    }

    // Group calls by execution policy
    const { sequential, parallel } = this.groupByPolicy(calls);
    const results: ToolCallResult[] = [];

    // Execute sequential tools first (in order)
    for (const call of sequential) {
      const result = await this.executeSingle(call, context);
      results.push(result);

      // Stop if aborted
      if (context.abortSignal?.aborted) {
        break;
      }
    }

    // Execute parallel tools concurrently (with concurrency limit)
    if (parallel.length > 0 && !context.abortSignal?.aborted) {
      const parallelResults = await this.executeParallel(parallel, context);
      results.push(...parallelResults);
    }

    return results;
  }

  /**
   * Execute a single tool call
   */
  async executeSingle(
    call: ToolCallRequest,
    context: Omit<ToolExecutionContext, 'callId'>
  ): Promise<ToolCallResult> {
    const startTime = Date.now();
    const fullContext: ToolExecutionContext = { ...context, callId: call.callId };

    // Find the tool
    const tool = this.registry.get(call.name);
    if (!tool) {
      const result: ToolCallResult = {
        toolName: call.name,
        callId: call.callId,
        result: null,
        durationMs: Date.now() - startTime,
        success: false,
        error: `Tool '${call.name}' not found`,
      };
      this.options.onToolError?.(call.name, call.callId, new Error(result.error));
      this.options.onToolEnd?.(result);
      return result;
    }

    // Validate arguments if enabled
    if (this.options.validateArguments) {
      const validation = validateToolArguments(tool.definition, call.arguments);
      if (!validation.valid) {
        const errorMsg = `Invalid arguments: ${validation.errors.join(', ')}`;
        const result: ToolCallResult = {
          toolName: call.name,
          callId: call.callId,
          result: null,
          durationMs: Date.now() - startTime,
          success: false,
          error: errorMsg,
        };
        this.options.onToolError?.(call.name, call.callId, new Error(errorMsg));
        this.options.onToolEnd?.(result);
        return result;
      }
    }

    // Notify start
    this.options.onToolStart?.(call.name, call.callId, call.arguments);

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        tool,
        call.arguments,
        fullContext
      );

      const toolResult: ToolCallResult = {
        toolName: call.name,
        callId: call.callId,
        result,
        durationMs: Date.now() - startTime,
        success: true,
      };

      this.options.onToolEnd?.(toolResult);
      return toolResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const toolResult: ToolCallResult = {
        toolName: call.name,
        callId: call.callId,
        result: null,
        durationMs: Date.now() - startTime,
        success: false,
        error: errorMessage,
      };

      this.options.onToolError?.(
        call.name,
        call.callId,
        error instanceof Error ? error : new Error(errorMessage)
      );
      this.options.onToolEnd?.(toolResult);
      return toolResult;
    }
  }

  /**
   * Execute multiple tools in parallel with concurrency limit
   */
  private async executeParallel(
    calls: ToolCallRequest[],
    context: Omit<ToolExecutionContext, 'callId'>
  ): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = [];
    const executing: Promise<void>[] = [];
    const queue = [...calls];

    while (queue.length > 0 || executing.length > 0) {
      // Check for abort
      if (context.abortSignal?.aborted) {
        break;
      }

      // Start new executions up to concurrency limit
      while (executing.length < this.options.maxConcurrency && queue.length > 0) {
        const call = queue.shift()!;
        const promise = this.executeSingle(call, context).then(result => {
          results.push(result);
          const index = executing.indexOf(promise);
          if (index > -1) {
            executing.splice(index, 1);
          }
        });
        executing.push(promise);
      }

      // Wait for at least one to complete
      if (executing.length > 0) {
        await Promise.race(executing);
      }
    }

    return results;
  }

  /**
   * Execute a tool handler with timeout
   */
  private async executeWithTimeout<TParams, TResult>(
    tool: Tool<TParams, TResult>,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<TResult> {
    const timeoutMs = this.options.timeout;

    // Create abort controller for timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    // Combine with external abort signal
    const combinedSignal = context.abortSignal
      ? this.combineAbortSignals(context.abortSignal, timeoutController.signal)
      : timeoutController.signal;

    try {
      const result = await Promise.race([
        tool.handler(args as TParams, { ...context, abortSignal: combinedSignal }),
        new Promise<never>((_, reject) => {
          combinedSignal.addEventListener('abort', () => {
            if (timeoutController.signal.aborted) {
              reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
            } else {
              reject(new Error('Tool execution aborted'));
            }
          });
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Combine multiple abort signals into one
   */
  private combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  /**
   * Group tool calls by their execution policy
   */
  private groupByPolicy(calls: ToolCallRequest[]): {
    sequential: ToolCallRequest[];
    parallel: ToolCallRequest[];
  } {
    const sequential: ToolCallRequest[] = [];
    const parallel: ToolCallRequest[] = [];

    for (const call of calls) {
      const tool = this.registry.get(call.name);
      const policy = tool?.definition.executionPolicy ?? this.options.defaultPolicy;

      if (policy === 'sequential') {
        sequential.push(call);
      } else {
        parallel.push(call);
      }
    }

    return { sequential, parallel };
  }
}

/**
 * Create a tool executor with a new registry
 */
export function createToolExecutor(
  tools: Tool<unknown, unknown>[],
  options?: ToolExecutorOptions
): ToolExecutor {
  const registry = new ToolRegistry();
  registry.registerAll(tools);
  return new ToolExecutor(registry, options);
}
