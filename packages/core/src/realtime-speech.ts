/**
 * Realtime speech-to-speech provider abstraction (RFC 0001).
 *
 * A RealtimeSpeechProvider connects a voice session to a provider's
 * native speech-to-speech model over a bidirectional stream: mic PCM
 * goes up, assistant PCM comes down, with transcripts, tool calls, and
 * turn events normalized into RealtimeSpeechEvent. Turn detection,
 * comprehension, and voice synthesis are provider-side; the orchestrator
 * relays audio and reacts to events.
 *
 * Experimental: shipped behind the opt-in `realtimeSpeech` server mode.
 */

import type { ToolDefinition } from './tools.js';

export interface RealtimeSpeechConfig {
  /** System prompt for the realtime model. */
  instructions?: string;
  /** Provider voice id (pass-through, e.g. OpenAI 'marin'). */
  voice?: string;
  /** Tool definitions - same shape as pipeline mode. */
  tools?: ToolDefinition[];
  /**
   * Emit user-transcript events (default true). Input transcription is
   * a separate transcription-model pass billed on top of realtime audio
   * tokens.
   */
  inputTranscription?: boolean;
  /**
   * Transcription model for user transcripts
   * (default: 'gpt-4o-mini-transcribe' on OpenAI; Gemini transcribes
   * natively).
   */
  transcriptionModel?: string;
  /** Provider-native VAD tuning. */
  turnDetection?:
    | { type: 'server_vad'; silenceDurationMs?: number; thresholdOverride?: number }
    | { type: 'semantic'; eagerness?: 'low' | 'medium' | 'high' | 'auto' };
  /** Per-response output token cap (the primary runaway-cost bound). */
  maxOutputTokens?: number;
  /** Context-size cost lever, provider-mapped. */
  contextManagement?: {
    strategy: 'truncate' | 'compress';
    /** OpenAI truncation retention ratio. */
    retentionRatio?: number;
    /** Gemini compression trigger tokens. */
    triggerTokens?: number;
  };
}

export interface RealtimeUsage {
  inputTokens: number;
  outputTokens: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  cachedTokens?: number;
}

/** Events pushed by the provider session, normalized across providers. */
export type RealtimeSpeechEvent =
  /** Assistant audio delta, tagged so stale deltas of a cancelled response can be dropped. */
  | { type: 'audio'; pcm: Buffer; sampleRate: number; responseId: string; itemId?: string }
  | { type: 'user-transcript'; text: string; isFinal: boolean }
  | { type: 'assistant-transcript'; text: string; isFinal: boolean }
  /** Barge-in signal (OpenAI server VAD; not emitted by Gemini). */
  | { type: 'user-speech-started' }
  | { type: 'user-speech-stopped' }
  | { type: 'response-started'; responseId: string }
  | { type: 'response-done'; responseId: string; usage?: RealtimeUsage }
  | { type: 'tool-call'; callId: string; name: string; arguments: Record<string, unknown> }
  /** Provider cancelled in-flight tool calls (Gemini interruption). */
  | { type: 'tool-call-cancelled'; callIds: string[] }
  /** Provider-driven barge-in (Gemini). */
  | { type: 'interrupted' }
  /** Session nearing its lifetime cap: Gemini goAway, OpenAI expires_at timer. */
  | { type: 'session-expiring'; inMs?: number }
  | { type: 'error'; error: Error; recoverable: boolean };

export interface RealtimeSpeechSession {
  /** PCM rate the session expects from sendAudio (16k Gemini, 24k OpenAI). */
  readonly inputSampleRate: number;
  /** PCM rate of emitted 'audio' events (24k for both current targets). */
  readonly outputSampleRate: number;
  /**
   * Ordered control stream. Consumers must never block this stream on
   * realtime-paced playback: move 'audio' events into a playback queue
   * synchronously and handle everything else immediately.
   */
  events(): AsyncIterable<RealtimeSpeechEvent>;
  /**
   * Fire-and-forget mic PCM (16-bit signed LE mono at inputSampleRate).
   * During an adapter-internal reconnect, frames are buffered (bounded)
   * and replayed once the session is re-established; frames beyond the
   * bound are dropped.
   */
  sendAudio(frame: Buffer): void;
  /**
   * Cancel the in-progress response, if any; a safe no-op when nothing
   * is active. playedMs (from the playback pacer) trims provider-side
   * history to the audio the user actually heard, where the provider
   * supports truncation.
   */
  cancelResponse(playedMs?: number): void;
  sendToolResult(callId: string, output: unknown): void;
  /** Live re-configuration (playbook stage changes swap instructions/tools). */
  update(config: Partial<RealtimeSpeechConfig>): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeSpeechProvider {
  name: string;
  connect(config: RealtimeSpeechConfig): Promise<RealtimeSpeechSession>;
}
