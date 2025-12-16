/**
 * Metrics Example
 *
 * Demonstrates how to build a custom metrics adapter for
 * Prometheus, DataDog, StatsD, or any metrics backend.
 *
 * Features shown:
 * - MetricsAdapter interface implementation
 * - Histogram buckets for latency tracking
 * - /metrics endpoint for Prometheus scraping
 * - Combining metrics with logging hooks
 *
 * Run: npm run dev:metrics
 */

import { config } from 'dotenv';
config();

import { createServer } from 'http';

import {
  LLMRTCServer,
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  ElevenLabsTTSProvider,
  createLoggingHooks,
  MetricNames,
  type MetricsAdapter
} from '@llmrtc/llmrtc-backend';

// =============================================================================
// Custom Prometheus-style Metrics Adapter
// =============================================================================

class PrometheusMetrics implements MetricsAdapter {
  // Store timing histograms with labels
  private histograms: Map<string, { values: number[]; tags: Record<string, string> }[]> = new Map();
  private counters: Map<string, { value: number; tags: Record<string, string> }[]> = new Map();
  private gauges: Map<string, { value: number; tags: Record<string, string> }> = new Map();

  increment(name: string, value = 1, tags: Record<string, string> = {}): void {
    const key = this.formatKey(name, tags);
    const existing = this.counters.get(key);
    if (existing) {
      existing[0].value += value;
    } else {
      this.counters.set(key, [{ value, tags }]);
    }
  }

  timing(name: string, durationMs: number, tags: Record<string, string> = {}): void {
    const key = this.formatKey(name, tags);
    const existing = this.histograms.get(key);
    if (existing) {
      existing[0].values.push(durationMs);
    } else {
      this.histograms.set(key, [{ values: [durationMs], tags }]);
    }
  }

  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    const key = this.formatKey(name, tags);
    this.gauges.set(key, { value, tags });
  }

  private formatKey(name: string, tags: Record<string, string>): string {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return tagStr ? `${name}{${tagStr}}` : name;
  }

  /**
   * Export metrics in Prometheus exposition format
   */
  getMetrics(): string {
    const lines: string[] = [];

    // Export counters
    for (const [key, entries] of this.counters) {
      const name = key.split('{')[0].replace(/\./g, '_');
      lines.push(`# TYPE ${name} counter`);
      for (const entry of entries) {
        const labels = this.formatLabels(entry.tags);
        lines.push(`${name}${labels} ${entry.value}`);
      }
    }

    // Export histograms (simplified - just _sum and _count)
    for (const [key, entries] of this.histograms) {
      const name = key.split('{')[0].replace(/\./g, '_');
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of entries) {
        const labels = this.formatLabels(entry.tags);
        const sum = entry.values.reduce((a, b) => a + b, 0);
        const count = entry.values.length;
        const avg = count > 0 ? (sum / count).toFixed(2) : 0;
        lines.push(`${name}_sum${labels} ${sum}`);
        lines.push(`${name}_count${labels} ${count}`);
        lines.push(`${name}_avg${labels} ${avg}`);
      }
    }

    // Export gauges
    for (const [key, entry] of this.gauges) {
      const name = key.split('{')[0].replace(/\./g, '_');
      const labels = this.formatLabels(entry.tags);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${labels} ${entry.value}`);
    }

    return lines.join('\n');
  }

  private formatLabels(tags: Record<string, string>): string {
    const pairs = Object.entries(tags).map(([k, v]) => `${k}="${v}"`);
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }

  /**
   * Get summary statistics for display
   */
  getSummary(): Record<string, { count: number; avg: number; min: number; max: number }> {
    const summary: Record<string, { count: number; avg: number; min: number; max: number }> = {};

    for (const [key, entries] of this.histograms) {
      const allValues = entries.flatMap(e => e.values);
      if (allValues.length > 0) {
        summary[key] = {
          count: allValues.length,
          avg: Math.round(allValues.reduce((a, b) => a + b, 0) / allValues.length),
          min: Math.min(...allValues),
          max: Math.max(...allValues)
        };
      }
    }

    return summary;
  }
}

// Create metrics instance
const metrics = new PrometheusMetrics();

// =============================================================================
// HTTP server for /metrics endpoint
// =============================================================================

const metricsServer = createServer((req, res) => {
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics.getMetrics());
  } else if (req.url === '/summary') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics.getSummary(), null, 2));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

metricsServer.listen(9090, () => {
  console.log(`  Metrics endpoint: http://localhost:9090/metrics`);
  console.log(`  Summary endpoint: http://localhost:9090/summary`);
});

// =============================================================================
// LLMRTCServer with metrics
// =============================================================================

const server = new LLMRTCServer({
  providers: {
    llm: new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }),
    stt: new OpenAIWhisperProvider({
      apiKey: process.env.OPENAI_API_KEY!
    }),
    tts: new ElevenLabsTTSProvider({
      apiKey: process.env.ELEVENLABS_API_KEY!,
      voiceId: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'
    })
  },
  port: 8787,
  streamingTTS: true,
  systemPrompt: 'You are a helpful voice assistant. Keep responses concise.',

  // Attach metrics adapter - the SDK will automatically emit timing metrics
  metrics,

  // Also add logging to see what's happening
  hooks: createLoggingHooks({ level: 'info', prefix: '[metrics-demo]' })
});

server.on('listening', ({ host, port }) => {
  console.log(`\n  Metrics Example Server`);
  console.log(`  ======================`);
  console.log(`  Server running at http://${host}:${port}`);
  console.log(`  Open http://localhost:5173 to use the client\n`);
});

server.on('error', (err) => {
  console.error(`[server] Error:`, err.message);
});

await server.start();

/**
 * After speaking a few times, visit:
 *
 * http://localhost:9090/metrics - Prometheus format
 * http://localhost:9090/summary - JSON summary
 *
 * Example /metrics output:
 *
 * # TYPE llmrtc_stt_duration_ms histogram
 * llmrtc_stt_duration_ms_sum 450
 * llmrtc_stt_duration_ms_count 3
 * llmrtc_stt_duration_ms_avg 150.00
 *
 * # TYPE llmrtc_llm_duration_ms histogram
 * llmrtc_llm_duration_ms_sum 940
 * llmrtc_llm_duration_ms_count 3
 * llmrtc_llm_duration_ms_avg 313.33
 *
 * Example /summary output:
 *
 * {
 *   "llmrtc.stt.duration_ms": { "count": 3, "avg": 150, "min": 120, "max": 180 },
 *   "llmrtc.llm.duration_ms": { "count": 3, "avg": 313, "min": 280, "max": 350 },
 *   "llmrtc.tts.duration_ms": { "count": 3, "avg": 85, "min": 75, "max": 95 },
 *   "llmrtc.turn.duration_ms": { "count": 3, "avg": 548, "min": 475, "max": 625 }
 * }
 */
