export type Role = 'system' | 'user' | 'assistant';

export interface VisionAttachment {
  /** base64-encoded image (data URI) or remote URL depending on provider */
  data: string;
  mimeType?: string;
  alt?: string;
}

export interface Message {
  role: Role;
  content: string;
  attachments?: VisionAttachment[];
}

export interface SessionConfig {
  systemPrompt?: string;
  historyLimit?: number;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface LLMRequest {
  messages: Message[];
  config?: SessionConfig;
  stream?: boolean;
}

export interface LLMChunk {
  content: string;
  done: boolean;
  raw?: unknown;
}

export interface LLMResult {
  fullText: string;
  raw?: unknown;
}

export interface LLMProvider {
  name: string;
  init?(): Promise<void> | void;
  complete(request: LLMRequest): Promise<LLMResult>;
  stream?(request: LLMRequest): AsyncIterable<LLMChunk>;
}

export interface STTConfig {
  language?: string;
  interimResults?: boolean;
  model?: string;
}

export interface STTResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  raw?: unknown;
}

export interface STTProvider {
  name: string;
  init?(): Promise<void> | void;
  /** One-shot transcription */
  transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult>;
  /** Streaming partials/finals */
  transcribeStream?(audio: AsyncIterable<Buffer>, config?: STTConfig): AsyncIterable<STTResult>;
}

export interface TTSConfig {
  voice?: string;
  format?: 'mp3' | 'ogg' | 'wav' | 'pcm';
  model?: string;
}

export interface TTSResult {
  audio: Buffer;
  format: TTSConfig['format'];
  raw?: unknown;
}

export interface TTSProvider {
  name: string;
  init?(): Promise<void> | void;
  speak(text: string, config?: TTSConfig): Promise<TTSResult>;
  speakStream?(text: string, config?: TTSConfig): AsyncIterable<Buffer>;
}

export interface VisionRequest {
  prompt: string;
  attachments: VisionAttachment[];
  stream?: boolean;
}

export interface VisionChunk {
  content: string;
  done: boolean;
  raw?: unknown;
}

export interface VisionResult {
  content: string;
  raw?: unknown;
}

export interface VisionProvider {
  name: string;
  init?(): Promise<void> | void;
  describe(request: VisionRequest): Promise<VisionResult>;
  stream?(request: VisionRequest): AsyncIterable<VisionChunk>;
}

export interface TurnCredentials {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface SignallingMessage {
  type: 'offer' | 'answer' | 'ice' | 'bye' | 'ping' | 'pong';
  payload?: unknown;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface TransportEvents {
  onTranscript?: (result: STTResult) => void;
  onLLMChunk?: (chunk: LLMChunk) => void;
  onLLMResult?: (result: LLMResult) => void;
  onTTS?: (audio: TTSResult) => void;
}

export interface ConversationProviders {
  llm: LLMProvider;
  stt: STTProvider;
  tts: TTSProvider;
  vision?: VisionProvider;
}

export interface ConversationOrchestratorConfig extends SessionConfig {
  providers: ConversationProviders;
  logger?: Logger;
}

// =============================================================================
// Audio Signaling Types (for MediaStreamTrack transport)
// =============================================================================

/**
 * Signal types for coordinating audio capture between client and server
 * when using MediaStreamTrack-based audio transport
 */
export type AudioSignalType = 'audio-start' | 'audio-stop' | 'audio-process';

/**
 * Sent when VAD detects speech start - server begins buffering audio
 */
export interface AudioStartSignal {
  type: 'audio-start';
  timestamp: number;
}

/**
 * Sent when VAD detects speech end - server stops buffering (without processing)
 */
export interface AudioStopSignal {
  type: 'audio-stop';
  timestamp: number;
}

/**
 * Sent when VAD detects speech end and audio should be processed
 * Includes any vision attachments captured during speech
 */
export interface AudioProcessSignal {
  type: 'audio-process';
  timestamp: number;
  attachments: VisionAttachment[];
}

/**
 * Union type for all audio signals
 */
export type AudioSignal = AudioStartSignal | AudioStopSignal | AudioProcessSignal;
