---
title: Core SDK Overview
---

`@metered/llmrtc-core` is the foundational package for LLMRTC, providing types, orchestrators, protocol definitions, and utilities shared across backend and frontend.

## Installation

```bash
npm install @metered/llmrtc-core
```

## When to Use Directly

Use `@metered/llmrtc-core` directly when:
- Building custom providers
- Creating bespoke backends without the full server
- Testing orchestration logic in isolation
- Implementing text-only agents (no voice)

For voice applications, use `@metered/llmrtc-backend` which re-exports core along with server functionality.

---

## Exports Overview

### Types

Core type definitions for the entire SDK:

```typescript
// Message types
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface Message { role: Role; content: string; attachments?: VisionAttachment[]; ... }
export interface VisionAttachment { data: string; mimeType?: string; alt?: string; }

// LLM types
export interface LLMRequest { messages: Message[]; tools?: ToolDefinition[]; ... }
export interface LLMResult { fullText: string; toolCalls?: ToolCallRequest[]; stopReason?: StopReason; }
export interface LLMChunk { content: string; done: boolean; toolCalls?: ToolCallRequest[]; }
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';

// STT types
export interface STTResult { text: string; isFinal: boolean; confidence?: number; }
export interface STTConfig { language?: string; model?: string; }

// TTS types
export interface TTSResult { audio: Buffer; format: 'mp3' | 'ogg' | 'wav' | 'pcm'; }
export interface TTSConfig { voice?: string; format?: 'mp3' | 'ogg' | 'wav' | 'pcm'; }
export interface TTSChunk { type: 'tts-chunk'; audio: Buffer; format: string; sampleRate?: number; }
export interface TTSStart { type: 'tts-start'; }
export interface TTSComplete { type: 'tts-complete'; }

// Vision types
export interface VisionRequest { prompt: string; attachments: VisionAttachment[]; }
export interface VisionResult { content: string; }

// Provider interfaces
export interface LLMProvider { name: string; complete(req: LLMRequest): Promise<LLMResult>; stream?(req): AsyncIterable<LLMChunk>; }
export interface STTProvider { name: string; transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult>; }
export interface TTSProvider { name: string; speak(text: string, config?: TTSConfig): Promise<TTSResult>; speakStream?(text, config): AsyncIterable<Buffer>; }
export interface VisionProvider { name: string; describe(req: VisionRequest): Promise<VisionResult>; }

// Orchestrator yield type (streaming)
export type OrchestratorYield = STTResult | LLMChunk | LLMResult | TTSResult | TTSChunk | TTSStart | TTSComplete;
```

### Classes

| Class | Description |
|-------|-------------|
| `ConversationOrchestrator` | Simple STT → LLM → TTS pipeline for single-prompt agents |
| `PlaybookOrchestrator` | Two-phase execution with stages, transitions, and tools |
| `PlaybookEngine` | Stage/transition state machine (used internally) |
| `ToolRegistry` | Tool registration and lookup |
| `ToolExecutor` | Tool execution with concurrency and timeout control |

### Tool Utilities

```typescript
// Define a typed tool
export function defineTool<TParams, TResult>(definition: ToolDefinition, handler: ToolHandler<TParams, TResult>): RegisteredTool;

// Validate tool arguments against schema
export function validateToolArguments(definition: ToolDefinition, args: unknown): ValidationResult;

// Tool types
export interface ToolDefinition { name: string; description: string; parameters: JSONSchema; }
export interface ToolCallRequest { callId: string; name: string; arguments: Record<string, unknown>; }
export interface ToolCallResult { callId: string; toolName: string; success: boolean; result?: unknown; error?: string; durationMs: number; }
```

### Protocol

```typescript
// Protocol version
export const PROTOCOL_VERSION = 1;

// Message constructors
export function createReadyMessage(sessionId: string, iceServers?: RTCIceServer[]): ReadyMessage;
export function createErrorMessage(code: ErrorCode, message: string): ErrorMessage;

// Error codes
export type ErrorCode =
  | 'WEBRTC_UNAVAILABLE' | 'CONNECTION_FAILED' | 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED'
  | 'STT_ERROR' | 'STT_TIMEOUT' | 'LLM_ERROR' | 'LLM_TIMEOUT' | 'TTS_ERROR' | 'TTS_TIMEOUT'
  | 'AUDIO_PROCESSING_ERROR' | 'VAD_ERROR' | 'INVALID_MESSAGE' | 'INVALID_AUDIO_FORMAT'
  | 'TOOL_ERROR' | 'PLAYBOOK_ERROR' | 'INTERNAL_ERROR' | 'RATE_LIMITED';
```

### Hooks

Observability hooks for monitoring and guardrails:

```typescript
export interface OrchestratorHooks {
  onTurnStart?(ctx, audio): void;
  onTurnEnd?(ctx, timing): void;
  onSTTStart?(ctx, audio): void;
  onSTTEnd?(ctx, result, timing): void;
  onSTTError?(ctx, error): void;
  onLLMStart?(ctx, request): void;
  onLLMChunk?(ctx, chunk, index): void;
  onLLMEnd?(ctx, result, timing): void;
  onLLMError?(ctx, error): void;
  onTTSStart?(ctx, text): void;
  onTTSChunk?(ctx, chunk, index): void;
  onTTSEnd?(ctx, timing): void;
  onTTSError?(ctx, error): void;
  onToolStart?(ctx, request): void;
  onToolEnd?(ctx, result, timing): void;
  onToolError?(ctx, request, error): void;
}

export interface ServerHooks {
  onConnection?(sessionId, connectionId): void;
  onDisconnect?(sessionId, timing): void;
  onSpeechStart?(sessionId, timestamp): void;
  onSpeechEnd?(sessionId, timestamp, audioDurationMs): void;
  onError?(error, context): void;
}

export interface PlaybookHooks {
  onStageEnter?(ctx, stage, previousStage): void;
  onStageExit?(ctx, stage, nextStage, timing): void;
  onTransition?(ctx, transition, from, to): void;
  onPlaybookTurnEnd?(ctx, response, toolCallCount): void;
  onPlaybookComplete?(ctx, finalStage, totalTurns): void;
}
```

### Hook Presets

```typescript
// Create hooks with timing logs
export function createTimingHooks(): OrchestratorHooks;

// Create hooks that only log errors
export function createErrorOnlyHooks(): OrchestratorHooks;

// Create verbose hooks for debugging
export function createVerboseHooks(): OrchestratorHooks;

// Create logging hooks with custom logger
export function createLoggingHooks(logger?: Logger): OrchestratorHooks;
```

### Metrics

```typescript
// Metric adapter interface
export interface MetricsAdapter {
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

// Built-in adapters
export class NoopMetrics implements MetricsAdapter { ... }
export class ConsoleMetrics implements MetricsAdapter { ... }
export class InMemoryMetrics implements MetricsAdapter { ... }

// Metric names
export const MetricNames = {
  STT_DURATION: 'llmrtc.stt.duration_ms',
  LLM_TTFT: 'llmrtc.llm.ttft_ms',
  LLM_DURATION: 'llmrtc.llm.duration_ms',
  LLM_TOKENS: 'llmrtc.llm.tokens',
  TTS_DURATION: 'llmrtc.tts.duration_ms',
  TURN_DURATION: 'llmrtc.turn.duration_ms',
  SESSION_DURATION: 'llmrtc.session.duration_ms',
  CONNECTIONS: 'llmrtc.connections',
  ERRORS: 'llmrtc.errors',
  TOOL_DURATION: 'llmrtc.tool.duration_ms',
  TOOL_CALLS: 'llmrtc.tool.calls',
  STAGE_DURATION: 'llmrtc.stage.duration_ms',
  STAGE_TRANSITIONS: 'llmrtc.stage.transitions'
};
```

---

## Related Pages

- [Tools](tools) - Tool definition and execution
- [Hooks & Metrics](hooks-and-metrics) - Observability setup
- [ConversationOrchestrator](conversation-orchestrator) - Simple agent
- [PlaybookOrchestrator](../playbooks/text-agents) - Multi-stage agent
