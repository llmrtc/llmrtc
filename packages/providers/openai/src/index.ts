import OpenAI, { toFile } from 'openai';
import WebSocket from 'ws';
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import {
  AsyncEventQueue,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResult,
  Message,
  STTProvider,
  STTConfig,
  STTResult,
  TTSProvider,
  TTSConfig,
  TTSResult
} from '@llmrtc/llmrtc-core';
import {
  mapToolsToOpenAI,
  mapToolChoiceToOpenAI,
  parseToolCallsFromOpenAI,
  mapStopReasonFromOpenAI,
  processToolCallDelta,
  finalizeToolCalls,
  StreamingToolCallAccumulator,
} from './tool-adapter.js';

export interface OpenAILLMConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export class OpenAILLMProvider implements LLMProvider {
  readonly name = 'openai-llm';
  private client: OpenAI;
  private model: string;

  constructor(private readonly config: OpenAILLMConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'gpt-4o-mini';
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: false,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });
    const choice = completion.choices?.[0];
    const fullText = choice?.message?.content ?? '';
    const toolCalls = parseToolCallsFromOpenAI(choice?.message?.tool_calls);
    const stopReason = mapStopReasonFromOpenAI(choice?.finish_reason);

    return { fullText, raw: completion, toolCalls, stopReason };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: mapMessages(request.messages),
      temperature: request.config?.temperature,
      top_p: request.config?.topP,
      max_tokens: request.config?.maxTokens,
      stream: true,
      ...(request.tools?.length && {
        tools: mapToolsToOpenAI(request.tools),
        tool_choice: mapToolChoiceToOpenAI(request.toolChoice),
      }),
    });

    // Accumulate tool calls across streaming chunks
    const toolCallAccumulators = new Map<number, StreamingToolCallAccumulator>();
    let finishReason: string | null = null;

    for await (const part of stream) {
      const choice = part.choices?.[0];
      const delta = choice?.delta;

      // Accumulate tool call deltas
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          processToolCallDelta(toolCallAccumulators, toolCallDelta);
        }
      }

      // Track finish reason
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }

      // Yield content delta
      const content = delta?.content ?? '';
      yield { content, done: false, raw: part };
    }

    // Final chunk with accumulated tool calls
    const toolCalls = toolCallAccumulators.size > 0
      ? finalizeToolCalls(toolCallAccumulators)
      : undefined;
    const stopReason = mapStopReasonFromOpenAI(finishReason);

    yield { content: '', done: true, toolCalls, stopReason };
  }
}

export interface OpenAIWhisperConfig {
  apiKey: string;
  baseURL?: string;
  /**
   * Transcription model (default: 'whisper-1'). The newer
   * 'gpt-4o-transcribe' and 'gpt-4o-mini-transcribe' models run on the
   * same endpoint with better accuracy, especially in noisy audio.
   */
  model?: string;
  language?: string;
}

export class OpenAIWhisperProvider implements STTProvider {
  readonly name = 'openai-whisper';
  private client: OpenAI;
  private model: string;
  private language?: string;

  constructor(config: OpenAIWhisperConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'whisper-1';
    this.language = config.language;
  }

  async transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult> {
    // The transcription endpoint keys decoding off the filename extension,
    // so sniff the actual container instead of assuming one
    const { filename, mimeType } = sniffAudioContainer(audio);
    // Use OpenAI SDK's toFile helper for cross-platform compatibility
    const file = await toFile(audio, filename, { type: mimeType });
    const res = await this.client.audio.transcriptions.create({
      file: file,
      model: config?.model ?? this.model,
      language: config?.language ?? this.language
    });
    return { text: res.text ?? '', isFinal: true, raw: res };
  }
}

/**
 * Detect the audio container from magic bytes so the upload filename
 * matches the actual data. Defaults to webm (the common browser capture
 * format) when unknown.
 */
function sniffAudioContainer(audio: Buffer): { filename: string; mimeType: string } {
  if (audio.length >= 12 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE') {
    return { filename: 'audio.wav', mimeType: 'audio/wav' };
  }
  if (audio.length >= 4 && audio.readUInt32BE(0) === 0x1a45dfa3) {
    return { filename: 'audio.webm', mimeType: 'audio/webm' };
  }
  if (audio.length >= 4 && audio.toString('ascii', 0, 4) === 'OggS') {
    return { filename: 'audio.ogg', mimeType: 'audio/ogg' };
  }
  if (
    audio.length >= 3 &&
    (audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))
  ) {
    return { filename: 'audio.mp3', mimeType: 'audio/mpeg' };
  }
  return { filename: 'audio.webm', mimeType: 'audio/webm' };
}

function mapMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return messages.map((m) => {
    // Handle tool result messages
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      } as ChatCompletionToolMessageParam;
    }

    // Handle assistant messages (may contain tool_calls reference for context)
    if (m.role === 'assistant') {
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || null,
      };

      // Include tool_calls if present (required for tool result messages to work)
      if (m.toolCalls?.length) {
        assistantMsg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.callId,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return assistantMsg;
    }

    // Handle system and user messages
    if (!m.attachments?.length) {
      return { role: m.role, content: m.content } as ChatCompletionMessageParam;
    }
    const imageParts = m.attachments.map((att) => ({ type: 'image_url' as const, image_url: { url: att.data } }));
    return { role: m.role, content: [{ type: 'text' as const, text: m.content }, ...imageParts] } as ChatCompletionMessageParam;
  });
}

// =============================================================================
// OpenAI TTS Provider
// =============================================================================

export type OpenAITTSVoice =
  | 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable'
  | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse'
  | (string & {});
export type OpenAITTSFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
export type OpenAITTSModel = 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts' | (string & {});

export interface OpenAITTSConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Base URL for API (optional, for Azure OpenAI or proxies) */
  baseURL?: string;
  /** TTS model (default: 'tts-1') */
  model?: OpenAITTSModel;
  /** Default voice (default: 'alloy') */
  voice?: OpenAITTSVoice;
  /** Speech speed multiplier 0.25-4.0 (default: 1.0). No effect on gpt-4o-mini-tts - use `instructions` to direct pacing there. */
  speed?: number;
  /**
   * Default delivery instructions (tone, pacing, emotion, accent) for
   * instructable models such as gpt-4o-mini-tts, e.g. "Speak like a
   * calm customer-support agent". Instructions are only sent when the
   * effective model name starts with 'gpt-'; on any other name
   * (tts-1, tts-1-hd, proxy/deployment aliases) they are ignored with
   * a one-time warning, since the API rejects them there.
   */
  instructions?: string;
}

/** The speech endpoint only accepts `instructions` on gpt-* TTS models. */
function ttsModelSupportsInstructions(model: string): boolean {
  return model.toLowerCase().startsWith('gpt-');
}

/**
 * OpenAI Text-to-Speech Provider.
 *
 * Available voices: alloy, ash, coral, echo, fable, nova, onyx, sage,
 * shimmer on all models; ballad and verse additionally on
 * gpt-4o-mini-tts.
 * Available models: tts-1 (fast), tts-1-hd (quality), gpt-4o-mini-tts
 * (instructable - accepts natural-language delivery `instructions`).
 *
 * @example
 * ```typescript
 * const provider = new OpenAITTSProvider({
 *   apiKey: 'sk-...',
 *   model: 'gpt-4o-mini-tts',
 *   voice: 'coral',
 *   instructions: 'Speak warmly, at a relaxed pace.'
 * });
 * ```
 */
export class OpenAITTSProvider implements TTSProvider {
  readonly name = 'openai-tts';
  /** OpenAI PCM output is 24kHz, 16-bit signed LE, mono */
  readonly pcmSampleRate = 24000;
  private client: OpenAI;
  private model: OpenAITTSModel;
  private voice: OpenAITTSVoice;
  private speed: number;
  private instructions?: string;
  private warnedInstructionsUnsupported = false;

  constructor(private readonly config: OpenAITTSConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.model = config.model ?? 'tts-1';
    this.voice = config.voice ?? 'alloy';
    this.speed = config.speed ?? 1.0;
    this.instructions = config.instructions;
  }

  private speechParams(text: string, overrideConfig?: TTSConfig) {
    const model = overrideConfig?.model ?? this.model;
    const params = {
      model,
      voice: overrideConfig?.voice ?? this.voice,
      input: text,
      response_format: mapFormat(overrideConfig?.format),
      speed: this.speed
    } as Parameters<OpenAI['audio']['speech']['create']>[0];

    const instructions = overrideConfig?.instructions ?? this.instructions;
    if (instructions) {
      if (ttsModelSupportsInstructions(model)) {
        params.instructions = instructions;
      } else if (!this.warnedInstructionsUnsupported) {
        this.warnedInstructionsUnsupported = true;
        console.warn(
          `[openai-tts] Model "${model}" does not support TTS instructions - ignoring them. ` +
            `Use an instructable model such as gpt-4o-mini-tts.`
        );
      }
    }
    return params;
  }

  async speak(text: string, overrideConfig?: TTSConfig): Promise<TTSResult> {
    const response = await this.client.audio.speech.create(
      this.speechParams(text, overrideConfig)
    );

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      audio: buffer,
      format: overrideConfig?.format ?? 'mp3',
      raw: response
    };
  }

  /**
   * Streaming TTS - returns audio chunks as they are generated.
   * Uses HTTP chunked transfer encoding.
   *
   * When using format: 'pcm', output is 24kHz, 16-bit signed LE, mono.
   * This is the recommended format for lowest latency (no decode step needed).
   */
  async *speakStream(text: string, overrideConfig?: TTSConfig): AsyncIterable<Buffer> {
    const response = await this.client.audio.speech.create(
      this.speechParams(text, overrideConfig)
    );

    // The SDK's response body is a web ReadableStream when a global fetch
    // is available, but a Node Readable when the SDK runs with its Node
    // shims (e.g. Node < 18 or an app importing 'openai/shims/node').
    // Handle both instead of assuming getReader() exists.
    const body: unknown = response.body;

    if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield Buffer.from(value);
      }
      return;
    }

    if (
      body &&
      typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
    ) {
      for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
        yield Buffer.from(chunk);
      }
      return;
    }

    // Fallback: return the whole buffer if streaming is not available
    const buffer = Buffer.from(await response.arrayBuffer());
    yield buffer;
  }
}

/**
 * Map core format to OpenAI format
 */
function mapFormat(format?: TTSConfig['format']): OpenAITTSFormat {
  switch (format) {
    case 'ogg':
      return 'opus'; // OpenAI uses 'opus' for Ogg container
    case 'wav':
      return 'wav';
    case 'pcm':
      return 'pcm';
    case 'mp3':
    default:
      return 'mp3';
  }
}

// =============================================================================
// OpenAI Realtime STT Provider (streaming transcription)
// =============================================================================

export interface OpenAIRealtimeSTTConfig {
  /** OpenAI API key */
  apiKey: string;
  /**
   * Transcription model (default: 'gpt-realtime-whisper' - native
   * streaming). 'gpt-4o-transcribe' / 'gpt-4o-mini-transcribe' also work
   * over the Realtime API.
   */
  model?: string;
  /** ISO language code hint */
  language?: string;
  /**
   * Latency/accuracy trade-off for gpt-realtime-whisper
   * (default: server-side default).
   */
  delay?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /**
   * Realtime WebSocket URL
   * (default: 'wss://api.openai.com/v1/realtime?intent=transcription')
   */
  url?: string;
  /**
   * Socket watchdog timeouts in ms. Defaults: connect 10000, inactivity
   * 30000, final-after-commit 15000. Mostly useful in tests.
   */
  timeoutsMs?: { connect?: number; inactivity?: number; final?: number };
}

interface RealtimeServerEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; type?: string; code?: string };
}

const REALTIME_STT_TIMEOUTS = { connect: 10000, inactivity: 30000, final: 15000 };

/**
 * OpenAI Realtime Speech-to-Text Provider.
 *
 * Streams audio to a transcription-type Realtime API session and yields
 * interim transcripts as the user speaks. Partial results carry the
 * accumulated transcript-so-far; the final result carries the complete
 * transcript. Billing follows the transcription model's audio pricing,
 * not realtime LLM tokens.
 *
 * Input frames must be 24kHz mono 16-bit signed LE PCM
 * (streamingInputSampleRate). transcribe() accepts a 16-bit mono PCM WAV
 * buffer for compatibility with the buffered pipeline; for general batch
 * transcription use OpenAIWhisperProvider instead.
 *
 * @example
 * ```typescript
 * const stt = new OpenAIRealtimeSTTProvider({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'gpt-realtime-whisper'
 * });
 * ```
 */
export class OpenAIRealtimeSTTProvider implements STTProvider {
  readonly name = 'openai-realtime-stt';
  /** The Realtime API consumes 24kHz mono 16-bit PCM */
  readonly streamingInputSampleRate = 24000;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly language?: string;
  private readonly delay?: OpenAIRealtimeSTTConfig['delay'];
  private readonly url: string;
  private readonly timeoutsMs: { connect: number; inactivity: number; final: number };

  constructor(config: OpenAIRealtimeSTTConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gpt-realtime-whisper';
    this.language = config.language;
    this.delay = config.delay;
    // intent=transcription opens a transcription-type session directly,
    // without naming an (unused) realtime LLM session model
    this.url = config.url ?? 'wss://api.openai.com/v1/realtime?intent=transcription';
    this.timeoutsMs = {
      connect: config.timeoutsMs?.connect ?? REALTIME_STT_TIMEOUTS.connect,
      inactivity: config.timeoutsMs?.inactivity ?? REALTIME_STT_TIMEOUTS.inactivity,
      final: config.timeoutsMs?.final ?? REALTIME_STT_TIMEOUTS.final
    };
  }

  async *transcribeStream(audio: AsyncIterable<Buffer>, config?: STTConfig): AsyncIterable<STTResult> {
    const model = config?.model ?? this.model;
    const ws = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });

    const queue = new AsyncEventQueue<STTResult>();
    let runningText = '';
    let completed = false;
    let commitSent = false;

    // Watchdog: a silently-stalled socket must not hang the voice turn
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = (ms: number, waitingFor: string) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        queue.fail(new Error(`OpenAI Realtime STT timed out waiting for ${waitingFor}`));
        ws.terminate();
      }, ms);
      watchdog.unref?.();
    };
    const disarmWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    armWatchdog(this.timeoutsMs.connect, 'connection');

    ws.on('message', (data: WebSocket.RawData) => {
      armWatchdog(
        commitSent ? this.timeoutsMs.final : this.timeoutsMs.inactivity,
        commitSent ? 'the final transcript' : 'server messages'
      );
      let event: RealtimeServerEvent;
      try {
        event = JSON.parse(data.toString()) as RealtimeServerEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case 'conversation.item.input_audio_transcription.delta':
          runningText += event.delta ?? '';
          queue.push({ text: runningText, isFinal: false, raw: event });
          break;
        case 'conversation.item.input_audio_transcription.completed':
          completed = true;
          queue.push({ text: event.transcript ?? runningText, isFinal: true, raw: event });
          queue.end();
          ws.close();
          break;
        case 'conversation.item.input_audio_transcription.failed':
          queue.fail(
            new Error(
              `OpenAI Realtime STT transcription failed: ${event.error?.message ?? JSON.stringify(event.error)}`
            )
          );
          ws.close();
          break;
        case 'error':
          queue.fail(
            new Error(
              `OpenAI Realtime STT error: ${event.error?.message ?? JSON.stringify(event.error)}`
            )
          );
          ws.close();
          break;
        default:
          break;
      }
    });

    ws.on('error', (err: Error) => {
      queue.fail(new Error(`OpenAI Realtime STT socket error: ${err.message}`));
    });

    ws.on('close', () => {
      disarmWatchdog();
      // A close before the final transcript means the utterance was lost;
      // surface it instead of silently producing an empty transcript
      // (no-op when the queue already ended or failed)
      if (!completed) {
        queue.fail(new Error('OpenAI Realtime STT connection closed before the final transcript'));
      }
    });

    const opened = new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
      ws.once('close', () => reject(new Error('socket closed before opening')));
    });

    const language = config?.language ?? this.language;

    const sendLoop = (async () => {
      await opened;
      armWatchdog(this.timeoutsMs.inactivity, 'server messages');
      // Transcription-type session; our own VAD segments the audio, so
      // server turn detection stays off and we commit manually
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: this.streamingInputSampleRate },
                transcription: {
                  model,
                  ...(language && { language }),
                  ...(this.delay && { delay: this.delay })
                },
                turn_detection: null
              }
            }
          }
        })
      );
      let sentAny = false;
      for await (const frame of audio) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (frame.length === 0) continue;
        sentAny = true;
        ws.send(
          JSON.stringify({ type: 'input_audio_buffer.append', audio: frame.toString('base64') })
        );
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      if (sentAny) {
        commitSent = true;
        armWatchdog(this.timeoutsMs.final, 'the final transcript');
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } else {
        // Nothing to transcribe; committing an empty buffer errors
        completed = true;
        queue.end();
        ws.close();
      }
    })().catch((err: Error) => {
      queue.fail(err);
      ws.close();
    });

    try {
      yield* queue;
    } finally {
      disarmWatchdog();
      // Close first: an abandoned sendLoop exits at its next frame once
      // the socket is no longer OPEN, instead of feeding a dead session
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      // sendLoop never rejects (errors route into the queue); the bounded
      // wait guards against a caller-owned frame iterable that never ends
      await Promise.race([
        sendLoop,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5000);
          t.unref?.();
        })
      ]);
    }
  }

  /**
   * One-shot transcription of a 16-bit mono PCM WAV buffer (the format
   * produced by the LLMRTC voice pipeline), streamed through a realtime
   * session. For arbitrary containers use OpenAIWhisperProvider.
   */
  async transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult> {
    const pcm = wavToRealtimePCM(audio, this.streamingInputSampleRate);
    const frames = (async function* () {
      // 100ms chunks
      const chunkBytes = 4800;
      for (let off = 0; off < pcm.length; off += chunkBytes) {
        yield pcm.subarray(off, Math.min(off + chunkBytes, pcm.length));
      }
    })();

    let last: STTResult = { text: '', isFinal: true };
    for await (const result of this.transcribeStream(frames, config)) {
      if (result.isFinal) {
        last = result;
      }
    }
    return last;
  }
}

/**
 * Extract PCM from a 16-bit mono WAV buffer and linearly resample it to
 * the target rate. Throws on non-WAV input.
 */
function wavToRealtimePCM(audio: Buffer, targetRate: number): Buffer {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(
      'OpenAIRealtimeSTTProvider.transcribe expects a 16-bit mono PCM WAV buffer; use OpenAIWhisperProvider for other formats'
    );
  }
  if (audio.toString('ascii', 36, 40) !== 'data') {
    // Non-canonical header (extended fmt chunk, LIST metadata, ...) would
    // silently misread the fields below - refuse instead
    throw new Error(
      'OpenAIRealtimeSTTProvider.transcribe expects a canonical 44-byte WAV header; use OpenAIWhisperProvider for other formats'
    );
  }
  const sourceRate = audio.readUInt32LE(24);
  const channels = audio.readUInt16LE(22);
  const bits = audio.readUInt16LE(34);
  if (channels !== 1 || bits !== 16) {
    throw new Error(
      `OpenAIRealtimeSTTProvider.transcribe expects 16-bit mono WAV (got ${bits}-bit, ${channels}ch)`
    );
  }
  const pcm = audio.subarray(44);
  if (sourceRate === targetRate) {
    return pcm;
  }
  const sourceSamples = Math.floor(pcm.length / 2);
  const targetSamples = Math.floor((sourceSamples * targetRate) / sourceRate);
  const out = Buffer.alloc(targetSamples * 2);
  for (let i = 0; i < targetSamples; i++) {
    const pos = (i * sourceRate) / targetRate;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, sourceSamples - 1);
    const frac = pos - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

export {
  OpenAIRealtimeSpeechProvider,
  type OpenAIRealtimeSpeechOptions
} from './realtime-speech.js';
