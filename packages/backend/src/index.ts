/**
 * @llmrtc/llmrtc-backend
 *
 * Real-time voice + vision conversation server.
 * Can be used as a CLI tool or imported as a library.
 *
 * CLI Usage:
 *   npx llmrtc-backend
 *
 * Library Usage:
 *   import { LLMRTCServer, OpenAILLMProvider, OpenAIWhisperProvider, ElevenLabsTTSProvider } from '@llmrtc/llmrtc-backend';
 *
 *   const server = new LLMRTCServer({
 *     providers: {
 *       llm: new OpenAILLMProvider({ apiKey: 'sk-...' }),
 *       stt: new OpenAIWhisperProvider({ apiKey: 'sk-...' }),
 *       tts: new ElevenLabsTTSProvider({ apiKey: '...' })
 *     },
 *     port: 3000
 *   });
 *
 *   await server.start();
 */

// =============================================================================
// Main API
// =============================================================================

export { LLMRTCServer } from './server.js';
export type { LLMRTCServerConfig, LLMRTCServerEvents } from './server.js';

// =============================================================================
// Playbook Voice Integration
// =============================================================================

export { VoicePlaybookOrchestrator } from './voice-playbook-orchestrator.js';
export type { VoicePlaybookConfig, VoicePlaybookYield } from './voice-playbook-orchestrator.js';
export type {
  TurnOrchestrator,
  TurnOrchestratorYield,
  ToolCallStartEvent,
  ToolCallEndEvent,
  StageChangeEvent
} from './turn-orchestrator.js';

// =============================================================================
// Re-export all providers for convenience
// Users don't need to install provider packages separately
// =============================================================================

// OpenAI providers
export {
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  OpenAITTSProvider
} from '@llmrtc/llmrtc-provider-openai';

// Anthropic provider
export { AnthropicLLMProvider } from '@llmrtc/llmrtc-provider-anthropic';

// Google provider
export { GeminiLLMProvider } from '@llmrtc/llmrtc-provider-google';

// AWS Bedrock provider
export { BedrockLLMProvider } from '@llmrtc/llmrtc-provider-bedrock';

// OpenRouter provider
export { OpenRouterLLMProvider } from '@llmrtc/llmrtc-provider-openrouter';

// LM Studio provider
export { LMStudioLLMProvider } from '@llmrtc/llmrtc-provider-lmstudio';

// ElevenLabs provider
export { ElevenLabsTTSProvider } from '@llmrtc/llmrtc-provider-elevenlabs';

// Local providers (Ollama, Faster-Whisper, Piper, Llava)
export {
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider,
  LlavaVisionProvider
} from '@llmrtc/llmrtc-provider-local';

// =============================================================================
// Re-export core types
// =============================================================================

export type {
  ConversationProviders,
  LLMProvider,
  STTProvider,
  TTSProvider,
  VisionProvider,
  Message,
  LLMRequest,
  LLMResult,
  LLMChunk,
  STTResult,
  TTSResult,
  VisionResult,
  VisionAttachment,
  // Playbook types
  Playbook,
  Stage,
  Transition,
  // Tool types
  ToolDefinition,
  ToolCallRequest,
  ToolCallResult
} from '@llmrtc/llmrtc-core';

// Re-export ToolRegistry class for playbook mode
export { ToolRegistry, defineTool } from '@llmrtc/llmrtc-core';

// =============================================================================
// Re-export hooks, metrics, and logging utilities
// =============================================================================

export {
  // Logging hooks factory
  createLoggingHooks,
  createErrorOnlyHooks,
  createVerboseHooks,
  createTimingHooks,

  // Metrics adapters
  MetricNames,
  NoopMetrics,
  ConsoleMetrics,
  InMemoryMetrics
} from '@llmrtc/llmrtc-core';

export type {
  // Hook types
  OrchestratorHooks,
  ServerHooks,
  TurnContext,
  TimingInfo,
  ErrorContext,

  // Logging types
  LogLevel,
  LoggerLike,
  LoggingHooksConfig,

  // Metrics types
  MetricsAdapter,
  MetricName
} from '@llmrtc/llmrtc-core';

// =============================================================================
// Re-export utilities for advanced use
// =============================================================================

export { SessionManager } from './session-manager.js';
export { AudioProcessor } from './audio-processor.js';
export { NativePeerServer } from './native-peer-server.js';
