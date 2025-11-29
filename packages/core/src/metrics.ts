/**
 * Metrics adapter interface for pluggable metrics reporting
 *
 * This module provides a simple interface for emitting metrics that can be
 * implemented by various backends (Prometheus, StatsD, CloudWatch, etc.)
 *
 * @example
 * ```typescript
 * // Using console metrics for debugging
 * const server = new LLMRTCServer({
 *   providers: { llm, stt, tts },
 *   metrics: new ConsoleMetrics()
 * });
 *
 * // Using a custom Prometheus adapter
 * class PrometheusMetrics implements MetricsAdapter {
 *   private histogram = new promClient.Histogram({
 *     name: 'llmrtc_duration_ms',
 *     help: 'Operation duration in milliseconds',
 *     labelNames: ['operation']
 *   });
 *
 *   timing(name: string, durationMs: number, tags?: Record<string, string>) {
 *     this.histogram.observe({ operation: name, ...tags }, durationMs);
 *   }
 *   // ... other methods
 * }
 * ```
 */

// =============================================================================
// Metric Names
// =============================================================================

/**
 * Standard metric names used by the SDK
 *
 * Integrators can use these constants when building dashboards or alerts:
 *
 * ```typescript
 * // Example Prometheus query
 * // histogram_quantile(0.95, rate(llmrtc_stt_duration_ms_bucket[5m]))
 * ```
 */
export const MetricNames = {
  // STT metrics
  /** Duration of STT transcription in milliseconds */
  STT_DURATION: 'llmrtc.stt.duration_ms',

  // LLM metrics
  /** Time to first LLM token in milliseconds */
  LLM_TTFT: 'llmrtc.llm.ttft_ms',
  /** Total LLM inference duration in milliseconds */
  LLM_DURATION: 'llmrtc.llm.duration_ms',
  /** Number of tokens generated (when available from provider) */
  LLM_TOKENS: 'llmrtc.llm.tokens',

  // TTS metrics
  /** Duration of TTS synthesis in milliseconds */
  TTS_DURATION: 'llmrtc.tts.duration_ms',

  // Turn metrics
  /** Total turn duration (STT + LLM + TTS) in milliseconds */
  TURN_DURATION: 'llmrtc.turn.duration_ms',

  // Session metrics
  /** Session duration in milliseconds */
  SESSION_DURATION: 'llmrtc.session.duration_ms',
  /** Number of active sessions (gauge) */
  ACTIVE_SESSIONS: 'llmrtc.sessions.active',
  /** Total turns per session */
  SESSION_TURNS: 'llmrtc.session.turns',

  // Error metrics
  /** Error counter by type/component */
  ERRORS: 'llmrtc.errors',

  // Connection metrics
  /** Number of active WebSocket connections */
  CONNECTIONS: 'llmrtc.connections.active',
  /** Reconnection attempts */
  RECONNECTIONS: 'llmrtc.reconnections'
} as const;

export type MetricName = typeof MetricNames[keyof typeof MetricNames];

// =============================================================================
// Metrics Adapter Interface
// =============================================================================

/**
 * Interface for metrics adapters
 *
 * Implement this interface to integrate with your preferred metrics backend.
 * All methods should be non-blocking and fail silently.
 */
export interface MetricsAdapter {
  /**
   * Increment a counter metric
   * @param name - Metric name (use MetricNames constants)
   * @param value - Value to increment by (default: 1)
   * @param tags - Optional key-value tags for dimensions
   *
   * @example
   * ```typescript
   * metrics.increment(MetricNames.ERRORS, 1, { component: 'stt', code: 'STT_ERROR' });
   * ```
   */
  increment(name: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record a timing/histogram metric
   * @param name - Metric name (use MetricNames constants)
   * @param durationMs - Duration in milliseconds
   * @param tags - Optional key-value tags for dimensions
   *
   * @example
   * ```typescript
   * metrics.timing(MetricNames.STT_DURATION, 150, { provider: 'whisper' });
   * ```
   */
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;

  /**
   * Set a gauge metric (current value)
   * @param name - Metric name (use MetricNames constants)
   * @param value - Current value
   * @param tags - Optional key-value tags for dimensions
   *
   * @example
   * ```typescript
   * metrics.gauge(MetricNames.ACTIVE_SESSIONS, sessionCount);
   * ```
   */
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

// =============================================================================
// Built-in Implementations
// =============================================================================

/**
 * No-op metrics adapter (default)
 *
 * Use this when metrics collection is disabled or not needed.
 * All methods are no-ops with minimal overhead.
 */
export class NoopMetrics implements MetricsAdapter {
  increment(): void {
    // No-op
  }

  timing(): void {
    // No-op
  }

  gauge(): void {
    // No-op
  }
}

/**
 * Console metrics adapter for debugging
 *
 * Logs all metrics to the console with timestamps.
 * Useful during development to verify metrics are being emitted correctly.
 *
 * @example
 * ```typescript
 * const server = new LLMRTCServer({
 *   providers: { llm, stt, tts },
 *   metrics: new ConsoleMetrics({ prefix: 'myapp' })
 * });
 *
 * // Output:
 * // [metric] myapp.llmrtc.stt.duration_ms 150ms { provider: 'whisper' }
 * // [metric] myapp.llmrtc.llm.duration_ms 320ms { model: 'gpt-4' }
 * ```
 */
export class ConsoleMetrics implements MetricsAdapter {
  private prefix: string;

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ? `${options.prefix}.` : '';
  }

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.log(`[metric] ${this.prefix}${name} +${value}${tagStr}`);
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.log(`[metric] ${this.prefix}${name} ${durationMs}ms${tagStr}`);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const tagStr = tags ? ` ${JSON.stringify(tags)}` : '';
    console.log(`[metric] ${this.prefix}${name} = ${value}${tagStr}`);
  }
}

/**
 * In-memory metrics collector for testing
 *
 * Stores all metrics in arrays for later inspection.
 * Useful in unit tests to verify metrics are emitted correctly.
 *
 * @example
 * ```typescript
 * const metrics = new InMemoryMetrics();
 * const orchestrator = new ConversationOrchestrator({
 *   providers: { llm, stt, tts },
 *   metrics
 * });
 *
 * // Run orchestrator...
 *
 * // Verify metrics
 * expect(metrics.timings.find(t => t.name === MetricNames.STT_DURATION)).toBeDefined();
 * expect(metrics.getLatestTiming(MetricNames.STT_DURATION)?.durationMs).toBeLessThan(200);
 * ```
 */
export class InMemoryMetrics implements MetricsAdapter {
  readonly counters: Array<{
    name: string;
    value: number;
    tags?: Record<string, string>;
    timestamp: number;
  }> = [];

  readonly timings: Array<{
    name: string;
    durationMs: number;
    tags?: Record<string, string>;
    timestamp: number;
  }> = [];

  readonly gauges: Array<{
    name: string;
    value: number;
    tags?: Record<string, string>;
    timestamp: number;
  }> = [];

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    this.counters.push({ name, value, tags, timestamp: Date.now() });
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    this.timings.push({ name, durationMs, tags, timestamp: Date.now() });
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.push({ name, value, tags, timestamp: Date.now() });
  }

  /**
   * Get the latest counter entry for a metric name
   */
  getLatestCounter(name: string) {
    return this.counters.filter(c => c.name === name).pop();
  }

  /**
   * Get the latest timing entry for a metric name
   */
  getLatestTiming(name: string) {
    return this.timings.filter(t => t.name === name).pop();
  }

  /**
   * Get the latest gauge entry for a metric name
   */
  getLatestGauge(name: string) {
    return this.gauges.filter(g => g.name === name).pop();
  }

  /**
   * Get sum of all counter increments for a metric name
   */
  getCounterSum(name: string): number {
    return this.counters
      .filter(c => c.name === name)
      .reduce((sum, c) => sum + c.value, 0);
  }

  /**
   * Clear all stored metrics
   */
  clear(): void {
    this.counters.length = 0;
    this.timings.length = 0;
    this.gauges.length = 0;
  }
}
