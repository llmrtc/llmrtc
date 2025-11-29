/**
 * @metered/llmrtc-backend
 *
 * Real-time voice + vision conversation server.
 * Can be used as a CLI tool or imported as a library.
 *
 * CLI Usage:
 *   npx llmrtc-backend
 *
 * Library Usage:
 *   import { LLMRTCServer, OpenAILLMProvider, OpenAIWhisperProvider, ElevenLabsTTSProvider } from '@metered/llmrtc-backend';
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
// Re-export all providers for convenience
// Users don't need to install provider packages separately
// =============================================================================

// OpenAI providers
export {
  OpenAILLMProvider,
  OpenAIWhisperProvider,
  OpenAITTSProvider
} from '@metered/llmrtc-provider-openai';

// Anthropic provider
export { AnthropicLLMProvider } from '@metered/llmrtc-provider-anthropic';

// Google provider
export { GeminiLLMProvider } from '@metered/llmrtc-provider-google';

// AWS Bedrock provider
export { BedrockLLMProvider } from '@metered/llmrtc-provider-bedrock';

// OpenRouter provider
export { OpenRouterLLMProvider } from '@metered/llmrtc-provider-openrouter';

// LM Studio provider
export { LMStudioLLMProvider } from '@metered/llmrtc-provider-lmstudio';

// ElevenLabs provider
export { ElevenLabsTTSProvider } from '@metered/llmrtc-provider-elevenlabs';

// Local providers (Ollama, Faster-Whisper, Piper, Llava)
export {
  OllamaLLMProvider,
  FasterWhisperProvider,
  PiperTTSProvider,
  LlavaVisionProvider
} from '@metered/llmrtc-provider-local';

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
  VisionAttachment
} from '@metered/llmrtc-core';

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
} from '@metered/llmrtc-core';

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
} from '@metered/llmrtc-core';

// =============================================================================
// Re-export utilities for advanced use
// =============================================================================

export { SessionManager } from './session-manager.js';
export { AudioProcessor } from './audio-processor.js';
export { NativePeerServer } from './native-peer-server.js';
