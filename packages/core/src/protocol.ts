/**
 * @metered/llmrtc Wire Protocol v1
 *
 * This file defines all JSON message types exchanged between
 * the web-client and backend over WebSocket and WebRTC data channel.
 *
 * See PROTOCOL.md in the repository root for full documentation.
 */

import type { VisionAttachment } from './types.js';

// =============================================================================
// Protocol Version
// =============================================================================

/**
 * Current protocol version.
 * Exchanged during handshake in the 'ready' message.
 */
export const PROTOCOL_VERSION = 1;

// =============================================================================
// Base Types
// =============================================================================

/**
 * Base interface for all protocol messages
 */
export interface BaseMessage {
  type: string;
}

// =============================================================================
// Client → Server Messages
// =============================================================================

/**
 * Heartbeat ping from client
 * Server responds with PongMessage
 */
export interface PingMessage extends BaseMessage {
  type: 'ping';
  /** Client timestamp (Date.now()) for RTT calculation */
  timestamp: number;
}

/**
 * WebRTC SDP offer from client
 * Initiates WebRTC peer connection
 */
export interface OfferMessage extends BaseMessage {
  type: 'offer';
  /** SDP offer from RTCPeerConnection.createOffer() */
  signal: RTCSessionDescriptionInit;
}

/**
 * Session reconnection request
 * Client attempts to recover a previous session after disconnect
 */
export interface ReconnectMessage extends BaseMessage {
  type: 'reconnect';
  /** Previous session ID to recover */
  sessionId: string;
}

/**
 * Audio data for transcription (legacy/fallback)
 * Prefer WebRTC audio track for lower latency
 */
export interface AudioMessage extends BaseMessage {
  type: 'audio';
  /** Base64-encoded audio buffer (WAV or other format) */
  data: string;
  /** Optional vision attachments to include with this audio */
  attachments?: VisionAttachment[];
}

/**
 * Vision attachments sent via data channel
 * Queued and sent with next speech segment
 */
export interface AttachmentsMessage extends BaseMessage {
  type: 'attachments';
  /** Array of image attachments */
  attachments: VisionAttachment[];
}

/**
 * Union of all client-to-server message types
 */
export type ClientMessage =
  | PingMessage
  | OfferMessage
  | ReconnectMessage
  | AudioMessage
  | AttachmentsMessage;

// =============================================================================
// Server → Client Messages
// =============================================================================

/**
 * Connection ready notification
 * Sent immediately after WebSocket connection is established
 */
export interface ReadyMessage extends BaseMessage {
  type: 'ready';
  /** Unique session ID assigned by server */
  id: string;
  /** Protocol version for compatibility checking */
  protocolVersion: number;
}

/**
 * Heartbeat pong response
 * Echoes client timestamp for RTT calculation
 */
export interface PongMessage extends BaseMessage {
  type: 'pong';
  /** Echoed from PingMessage.timestamp */
  timestamp: number;
}

/**
 * WebRTC SDP answer from server
 * Response to client's OfferMessage
 */
export interface SignalMessage extends BaseMessage {
  type: 'signal';
  /** SDP answer from server's RTCPeerConnection */
  signal: RTCSessionDescriptionInit;
}

/**
 * Session reconnection acknowledgment
 */
export interface ReconnectAckMessage extends BaseMessage {
  type: 'reconnect-ack';
  /** Whether reconnection was successful */
  success: boolean;
  /** Session ID (may be new if original not found) */
  sessionId: string;
  /** Whether conversation history was recovered */
  historyRecovered: boolean;
}

/**
 * Speech-to-text transcription result
 */
export interface TranscriptMessage extends BaseMessage {
  type: 'transcript';
  /** Transcribed text */
  text: string;
  /** Whether this is the final transcription */
  isFinal: boolean;
}

/**
 * LLM response chunk (streaming)
 */
export interface LLMChunkMessage extends BaseMessage {
  type: 'llm-chunk';
  /** Partial response content */
  content: string;
  /** Whether this is the final chunk */
  done: boolean;
}

/**
 * Complete LLM response
 */
export interface LLMMessage extends BaseMessage {
  type: 'llm';
  /** Full response text */
  text: string;
}

/**
 * TTS playback starting
 * Sent before first audio chunk
 */
export interface TTSStartMessage extends BaseMessage {
  type: 'tts-start';
}

/**
 * TTS audio chunk (streaming)
 * Sent when WebRTC audio track is not available
 */
export interface TTSChunkMessage extends BaseMessage {
  type: 'tts-chunk';
  /** Audio format (e.g., 'pcm', 'mp3') */
  format: string;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Base64-encoded audio data */
  data: string;
}

/**
 * Complete TTS audio (non-streaming)
 * Sent when WebRTC audio track is not available
 */
export interface TTSMessage extends BaseMessage {
  type: 'tts';
  /** Audio format (e.g., 'mp3', 'wav') */
  format: string;
  /** Base64-encoded audio data */
  data: string;
}

/**
 * TTS playback complete
 * Sent after all audio has been delivered
 */
export interface TTSCompleteMessage extends BaseMessage {
  type: 'tts-complete';
}

/**
 * TTS playback cancelled
 * Sent when user interrupts (barge-in)
 */
export interface TTSCancelledMessage extends BaseMessage {
  type: 'tts-cancelled';
}

/**
 * VAD detected speech start
 * User has started speaking
 */
export interface SpeechStartMessage extends BaseMessage {
  type: 'speech-start';
}

/**
 * VAD detected speech end
 * User has stopped speaking, processing begins
 */
export interface SpeechEndMessage extends BaseMessage {
  type: 'speech-end';
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Error codes for structured error messages
 */
export type ErrorCode =
  | 'WEBRTC_UNAVAILABLE'
  | 'AUDIO_PROCESSING_ERROR'
  | 'STT_ERROR'
  | 'LLM_ERROR'
  | 'TTS_ERROR'
  | 'INVALID_MESSAGE'
  | 'SESSION_NOT_FOUND'
  | 'INTERNAL_ERROR';

/**
 * Error message from server
 */
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  /** Structured error code */
  code: ErrorCode;
  /** Human-readable error description */
  message: string;
}

/**
 * Union of all server-to-client message types
 */
export type ServerMessage =
  | ReadyMessage
  | PongMessage
  | SignalMessage
  | ReconnectAckMessage
  | TranscriptMessage
  | LLMChunkMessage
  | LLMMessage
  | TTSStartMessage
  | TTSChunkMessage
  | TTSMessage
  | TTSCompleteMessage
  | TTSCancelledMessage
  | SpeechStartMessage
  | SpeechEndMessage
  | ErrorMessage;

/**
 * Union of all protocol messages
 */
export type ProtocolMessage = ClientMessage | ServerMessage;

// =============================================================================
// Type Guards
// =============================================================================

/** Client message type literals */
const CLIENT_MESSAGE_TYPES = new Set([
  'ping',
  'offer',
  'reconnect',
  'audio',
  'attachments'
]);

/** Server message type literals */
const SERVER_MESSAGE_TYPES = new Set([
  'ready',
  'pong',
  'signal',
  'reconnect-ack',
  'transcript',
  'llm-chunk',
  'llm',
  'tts-start',
  'tts-chunk',
  'tts',
  'tts-complete',
  'tts-cancelled',
  'speech-start',
  'speech-end',
  'error'
]);

/**
 * Check if a message is a client-to-server message
 */
export function isClientMessage(msg: ProtocolMessage): msg is ClientMessage {
  return CLIENT_MESSAGE_TYPES.has(msg.type);
}

/**
 * Check if a message is a server-to-client message
 */
export function isServerMessage(msg: ProtocolMessage): msg is ServerMessage {
  return SERVER_MESSAGE_TYPES.has(msg.type);
}

/**
 * Check if a message is an error message
 */
export function isErrorMessage(msg: ProtocolMessage): msg is ErrorMessage {
  return msg.type === 'error';
}

/**
 * Parse and validate a JSON message
 * Returns null if parsing fails or message type is unknown
 */
export function parseMessage(json: string): ProtocolMessage | null {
  try {
    const msg = JSON.parse(json);
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') {
      return null;
    }
    if (!CLIENT_MESSAGE_TYPES.has(msg.type) && !SERVER_MESSAGE_TYPES.has(msg.type)) {
      return null;
    }
    return msg as ProtocolMessage;
  } catch {
    return null;
  }
}

// =============================================================================
// Message Constructors (for type-safe message creation)
// =============================================================================

/**
 * Create a ready message
 */
export function createReadyMessage(id: string): ReadyMessage {
  return { type: 'ready', id, protocolVersion: PROTOCOL_VERSION };
}

/**
 * Create an error message
 */
export function createErrorMessage(code: ErrorCode, message: string): ErrorMessage {
  return { type: 'error', code, message };
}

/**
 * Create a transcript message
 */
export function createTranscriptMessage(text: string, isFinal: boolean): TranscriptMessage {
  return { type: 'transcript', text, isFinal };
}

/**
 * Create an LLM chunk message
 */
export function createLLMChunkMessage(content: string, done: boolean): LLMChunkMessage {
  return { type: 'llm-chunk', content, done };
}

/**
 * Create an LLM message
 */
export function createLLMMessage(text: string): LLMMessage {
  return { type: 'llm', text };
}

/**
 * Create a TTS chunk message
 */
export function createTTSChunkMessage(
  data: string,
  format: string,
  sampleRate: number
): TTSChunkMessage {
  return { type: 'tts-chunk', data, format, sampleRate };
}

/**
 * Create a TTS message
 */
export function createTTSMessage(data: string, format: string): TTSMessage {
  return { type: 'tts', data, format };
}
