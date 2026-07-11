# RFC 0001: Realtime Speech-to-Speech Orchestrator Mode

- **Status**: Draft
- **Created**: 2026-07-11
- **Scope**: LLMRTC backend, core, protocol, web client
- **Target providers**: OpenAI Realtime API (`gpt-realtime-2.1` family) first, Google Gemini Live API second

## Summary

Add an opt-in **realtime relay mode** to `LLMRTCServer` that connects each
voice session to a provider's native speech-to-speech model over
WebSocket, relaying WebRTC mic audio upstream and provider audio
downstream, instead of running the STT → LLM → TTS pipeline. The mode
reuses LLMRTC's existing strengths — WebRTC transport, tool registry,
playbooks, client protocol, hooks/metrics — while delegating turn
detection, comprehension, and voice synthesis to a single end-to-end
audio model.

A provider-agnostic `RealtimeSpeechProvider` interface abstracts the two
target APIs, which differ meaningfully (sample rates, barge-in
direction, session lifetimes) but share the same conceptual shape:
bidirectional audio over a WebSocket with tool calls, transcripts, and
turn events.

## Motivation

The pipeline architecture (VAD → STT → LLM → TTS) is flexible — any
model mix, full transcript control, per-stage providers — but its
end-to-end latency is the sum of its stages. With streaming STT
(Phase 4) and streaming TTS the practical floor is roughly 800–1500ms
from end-of-speech to first audio (provider- and network-dependent;
the docs' streaming-latency diagrams show idealized, not measured,
timings). Native speech-to-speech models
respond in ~300–500ms, preserve prosody/emotion from the user's voice,
and handle mid-utterance interruptions natively.

Both directions matter. The pipeline remains the right choice when you
need a specific LLM (Claude, GLM, local), transcript-first workflows,
or cost control below realtime-audio pricing. Relay mode is the right
choice for latency-critical, conversation-first products. LLMRTC should
offer both behind the same client API.

### Cost reality check (why this must be opt-in)

At `gpt-realtime-2.1` rates (audio in $32/M tokens ≈ $0.019/min, audio
out $64/M ≈ $0.077/min, cached input $0.40/M), a 10-minute conversation
with ~40% assistant speech costs roughly $0.50–0.90 — an order of
magnitude above a pipeline with `gpt-4o-mini-transcribe` +
`gpt-4o-mini` + `gpt-4o-mini-tts`. `gpt-realtime-2.1-mini` (audio
$10/$20) and Gemini (`audio in $3/M, out $12/M`) narrow the gap. Cost
controls are therefore a first-class design concern (§ Cost controls),
not an afterthought.

## Goals

1. **Additive**: pipeline mode untouched; relay mode is opt-in server
   config. No breaking changes to `@llmrtc/*` public APIs.
2. **Provider-agnostic core**: one orchestrator, N provider adapters;
   OpenAI first, Gemini Live second, adapters live in the existing
   provider packages.
3. **Tools and playbooks work in relay mode**: the same
   `ToolRegistry`/`defineTool` definitions and playbook stages drive
   provider-native function calling and session instruction updates.
4. **Client compatibility**: existing web clients keep working —
   transcripts, TTS audio track, barge-in events arrive over the same
   protocol, with additive extensions only.
5. **Observability**: hooks and metrics parity (turn timings, token
   usage per response, interruption counts).

## Non-goals

- Client-direct provider connections via ephemeral tokens (documented
  as a future option; see Alternatives).
- Telephony/SIP transport.
- Security hardening details (tracked separately in the security pass).
- Vision/video input to realtime models (both APIs support image/video
  input; deferred to keep v1 scoped to audio).

## Background: current architecture

Today `LLMRTCServer` owns a per-connection `NativePeerServer`
(RTCAudioSink/Source, 48kHz PCM), an `AudioProcessor` (Silero VAD;
buffered utterances, or live frames in streaming-STT mode), and a
`TurnOrchestrator` (simple or playbook) that runs STT → LLM → TTS and
yields protocol events that `handleAudio` relays to the client
(`transcript`, `llm-chunk`, `tts-start`/`tts-chunk`/`tts-complete`,
`tts-cancelled`). TTS PCM is fed to the client through a paced PCM
feeder onto the WebRTC audio track.

Relay mode replaces the *turn machinery* (VAD-triggered turns, STT,
LLM, TTS) but keeps the *transport and protocol layer* (peer, PCM
feeder, WebSocket signaling, session manager, hooks).

## Design

### 1. Provider abstraction (`@llmrtc/llmrtc-core`)

```ts
export interface RealtimeSpeechConfig {
  instructions?: string;              // system prompt
  voice?: string;                     // provider voice id
  tools?: ToolDefinition[];           // same defs as pipeline mode
  inputTranscription?: boolean;       // user-transcript events (default true)
  turnDetection?:                     // provider-native VAD tuning
    | { type: 'server_vad'; silenceDurationMs?: number; thresholdOverride?: number }
    | { type: 'semantic'; eagerness?: 'low' | 'medium' | 'high' | 'auto' }
    | { type: 'manual' };             // orchestrator sends explicit turn marks
  maxOutputTokens?: number;
  contextManagement?: {               // cost lever, provider-mapped
    strategy: 'truncate' | 'compress';
    retentionRatio?: number;          // OpenAI truncation
    triggerTokens?: number;           // Gemini compression
  };
}

/** Events pushed by the provider session. */
export type RealtimeSpeechEvent =
  | { type: 'audio'; pcm: Buffer; sampleRate: number }          // assistant audio
  | { type: 'user-transcript'; text: string; isFinal: boolean }
  | { type: 'assistant-transcript'; text: string; isFinal: boolean }
  | { type: 'user-speech-started' }                              // barge-in signal
  | { type: 'response-started' }
  | { type: 'response-done'; usage?: RealtimeUsage }
  | { type: 'tool-call'; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool-call-cancelled'; callIds: string[] }           // Gemini interruption
  | { type: 'interrupted' }                                      // provider-driven barge-in
  | { type: 'session-expiring'; inMs?: number }                  // Gemini goAway
  | { type: 'error'; error: Error; recoverable: boolean };

export interface RealtimeSpeechSession {
  /** PCM rate the session expects from sendAudio (16k Gemini, 24k OpenAI). */
  readonly inputSampleRate: number;
  /** PCM rate of emitted 'audio' events (24k for both targets). */
  readonly outputSampleRate: number;
  events(): AsyncIterable<RealtimeSpeechEvent>;   // AsyncEventQueue-backed
  sendAudio(frame: Buffer): void;                 // 16-bit mono PCM
  /** Cancel the in-progress response; playedMs trims provider-side history
   *  to the audio the user actually heard (OpenAI truncate). */
  cancelResponse(playedMs?: number): void;
  sendToolResult(callId: string, output: unknown): void;
  /** Live re-configuration: playbook stage changes swap instructions/tools. */
  update(config: Partial<RealtimeSpeechConfig>): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeSpeechProvider {
  name: string;
  connect(config: RealtimeSpeechConfig): Promise<RealtimeSpeechSession>;
}
```

Design notes:

- `events()` is a single ordered stream (backed by the existing
  `AsyncEventQueue`), mirroring how Phase 4's `transcribeStream`
  bridges WS callbacks; the orchestrator consumes it in one loop, which
  keeps ordering guarantees trivial.
- `sendAudio` is fire-and-forget (both APIs are unacknowledged
  appends); backpressure is not a practical concern at 24kHz PCM
  (~48KB/s) but the adapter may drop frames if the socket's
  `bufferedAmount` exceeds a threshold, emitting a metric.
- The interface deliberately does *not* expose provider event names;
  everything the orchestrator needs is normalized.

### 2. Provider adapters

**`OpenAIRealtimeSpeechProvider`** (`@llmrtc/llmrtc-provider-openai`):

- Connect `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1`
  (Authorization bearer; GA interface, no beta header), then
  `session.update` with `session.type: "realtime"`,
  `output_modalities: ["audio"]`, `audio.input.format
  {type:"audio/pcm", rate:24000}`, `audio.output.format audio/pcm`,
  voice, instructions, tools, `turn_detection` mapped from config
  (`server_vad` | `semantic_vad` with eagerness | `null` for manual).
- Event mapping: `response.output_audio.delta` → `audio` (24kHz);
  `conversation.item.input_audio_transcription.delta/completed` →
  `user-transcript` (requires `audio.input.transcription` set);
  `response.output_audio_transcript.delta/done` →
  `assistant-transcript`; `input_audio_buffer.speech_started` →
  `user-speech-started`; `response.done` → `response-done` with usage;
  `response.function_call_arguments.done` → `tool-call`.
- `cancelResponse(playedMs)` → `response.cancel` +
  `conversation.item.truncate {item_id, content_index, audio_end_ms:
  playedMs}` so the model's history matches what the user heard.
- `sendToolResult` → `conversation.item.create {type:
  "function_call_output", call_id, output: JSON.stringify(output)}` +
  `response.create`.
- Cost levers: `session.max_output_tokens`; `session.truncation
  {type:"retention_ratio", retention_ratio}`. Audio input caching is
  automatic (cached audio input $0.40/M ≈ 99% off).
- Default model `gpt-realtime-2.1`; `gpt-realtime-2.1-mini` documented
  as the cost-sensitive choice. Reuses Phase 4's watchdog pattern
  (connect / inactivity timeouts).

**`GeminiLiveSpeechProvider`** (`@llmrtc/llmrtc-provider-google`):

- Connect `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;
  first message `setup` with model (default
  `gemini-3.1-flash-live-preview`), `generationConfig.responseModalities:
  ["AUDIO"]`, `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`,
  `systemInstruction`, `tools`, `inputAudioTranscription: {}`,
  `outputAudioTranscription: {}`, `realtimeInputConfig` (VAD mapping or
  `automaticActivityDetection.disabled` for manual),
  `contextWindowCompression {slidingWindow: {}, triggerTokens}`, and
  `sessionResumption`.
- Audio in: `realtimeInput.audio {data, mimeType: "audio/pcm;rate=16000"}`
  (16kHz in); out: `serverContent.modelTurn.parts[].inlineData` (24kHz
  PCM) → `audio`. `serverContent.interrupted` → `interrupted`;
  `toolCall.functionCalls` → `tool-call`; `toolCallCancellation` →
  `tool-call-cancelled`; `inputTranscription`/`outputTranscription` →
  transcript events; `goAway.timeLeft` → `session-expiring`.
- **Session lifetime is the hard part**: ~10-minute WebSocket lifetime,
  15-minute audio session cap without compression. The adapter owns
  reconnection: on `goAway` (or socket loss) it reconnects with the
  stored `sessionResumptionUpdate.newHandle`, transparently to the
  orchestrator. Context window compression is enabled by default in
  relay mode to lift the 15-minute cap.
- `update()` limitation: Gemini's setup is connect-time only; the
  adapter implements instruction/tool swaps by reconnecting with
  session resumption (documented behavioral difference; measured pause
  expected to be sub-second).
- Gemini Live is **preview** (Google's banner recommends the GA
  "Interactions API" for the latest features); the adapter ships as
  experimental, and the abstraction leaves room for an Interactions API
  adapter later.

### 3. Server orchestration (`@llmrtc/llmrtc-backend`)

New `RealtimeRelayOrchestrator` (not a `TurnOrchestrator` — turns are
provider-driven), selected by config:

```ts
interface RealtimeSpeechServerOptions extends RealtimeSpeechConfig {
  provider: RealtimeSpeechProvider;
  budget?: {                          // see Cost controls
    maxSessionMs?: number;
    maxTokens?: number;
    onExceeded?: 'warn' | 'end-session';
  };
}

const server = new LLMRTCServer({
  realtimeSpeech: {
    provider: new OpenAIRealtimeSpeechProvider({ apiKey: ... }),
    voice: 'marin',
    // instructions default to systemPrompt; tools default to toolRegistry
  },
  systemPrompt: '...',
  toolRegistry,          // reused as-is
  playbook,              // optional, see §5
  providers: { ... }     // optional pipeline fallback (see Fallback)
});
```

Per connection:

1. On peer/audio track ready, `provider.connect()` with instructions =
   effective system prompt, tools = registry definitions, voice, VAD
   config. Emit `mode: 'realtime'` in the protocol `ready` message.
2. **Upstream audio**: `peer.on('audioData')` frames (48kHz Int16) are
   resampled to `session.inputSampleRate` by extending the
   `AudioProcessor` tee (Phase 4 infrastructure) with a new
   pass-through mode that streams *all* frames unconditionally — today
   the tee only streams while VAD-detected speech is active, but in
   relay mode turn detection is provider-side. Frames go straight to
   `session.sendAudio()`.
3. **Downstream audio**: `audio` events feed the existing PCM feeder
   (`pcmSampleRate` from `session.outputSampleRate`) onto the TTS
   track — the same path pipeline TTS uses, so client playback code is
   unchanged. The feeder's pacing state doubles as the **played-ms
   clock** used for truncation on barge-in.
4. **Event loop**: one `for await` over `session.events()` translating
   to protocol messages (mapping table below) and hooks/metrics.
5. Teardown mirrors Phase 4 rules: peer/ws close ends the upstream
   feed and closes the session (watchdogs prevent leaks).

Event → protocol mapping:

| Session event | Protocol message | Notes |
|---|---|---|
| `user-transcript` | `transcript {text, isFinal}` | identical to pipeline |
| `assistant-transcript` | `assistant-transcript {text, isFinal}` | **new message type** |
| `response-started` | `tts-start` | reuses pipeline semantics |
| `audio` | (audio track) | via PCM feeder, no protocol message |
| `response-done` | `tts-complete` + `usage` event | usage is **new** |
| `user-speech-started` | `speech-start` + barge-in (below) | |
| `interrupted` | `tts-cancelled` + feeder flush | |
| `tool-call` / result | `tool-call-start` / `tool-call-end` | existing playbook messages |
| `error` | `error {code: REALTIME_ERROR}` | |

### 4. Barge-in mapping

The two providers invert responsibility, normalized as follows:

- **OpenAI (client-driven)**: on `user-speech-started` while a response
  is playing, the orchestrator (a) flushes the PCM feeder, (b) sends
  `tts-cancelled` to the client, (c) calls
  `session.cancelResponse(playedMs)` where `playedMs` comes from the
  feeder's pacing clock — this truncates provider-side history to what
  the user actually heard, which is what makes "no, stop—" follow-ups
  coherent. With `semantic_vad` + `interrupt_response: true` the
  provider self-cancels; the orchestrator still flushes and notifies.
- **Gemini (server-driven)**: `interrupted` arrives from the provider;
  the orchestrator flushes the feeder and sends `tts-cancelled`.
  Pending `tool-call-cancelled` ids abort in-flight executor calls via
  their `AbortSignal`.

The local Silero VAD is **not** used for turn-taking in relay mode but
can optionally run for metrics/diagnostics parity.

### 5. Tools and playbooks

- **Tools**: `ToolRegistry` definitions map 1:1 to both providers'
  function schemas (both accept JSON Schema parameters). `tool-call`
  events run through the existing `ToolExecutor` (timeouts, error
  wrapping, hooks preserved); results return via `sendToolResult`.
  Parallel calls: OpenAI emits sequential `function_call` items within
  a response; Gemini can batch `functionCalls` — the orchestrator
  executes with the same concurrency semantics as the pipeline's
  two-phase executor.
- **Playbooks**: stages map to `session.update({instructions, tools})`.
  The `PlaybookEngine` (stage state machine, transition rules) is
  reused; what changes is the *effect* of a transition — instead of
  altering the next LLM request, it reconfigures the live session.
  LLM-decision transitions are implemented by exposing the internal
  `playbook_transition` tool to the realtime model, identical to
  pipeline mode. Stage `onEnter` announcements are delivered as a
  `response.create` with stage instructions (OpenAI) or a text
  `realtimeInput` nudge (Gemini). Two-phase execution (silent tool
  loop, then spoken answer) is approximated with
  `response.create {output_modalities:["text"]}` for the tool phase on
  OpenAI; Gemini native-audio models only support AUDIO out, so
  playbooks on Gemini run single-phase (documented limitation).

### 6. Protocol extensions (additive)

- `ready` gains `mode: 'pipeline' | 'realtime'`.
- New server→client messages: `assistant-transcript {text, isFinal}`,
  `usage {inputTokens, outputTokens, audioInputTokens, audioOutputTokens, cachedTokens}`.
- Web client: new events `assistantTranscript(text, isFinal)` and
  `usage(usage)`; current clients ignore unrecognized message types
  (verified: `handlePayload`'s switch takes no action on unmatched
  types, and the message schema passes unknown types through), so old
  clients degrade gracefully.
- New protocol error codes: `REALTIME_ERROR`, `BUDGET_EXCEEDED` (added
  to the `ErrorCode` union).

### 7. Cost controls

1. `maxOutputTokens` per response (both providers).
2. Context: OpenAI `truncation.retention_ratio` (default 0.8 in relay
   mode); Gemini `contextWindowCompression` (default on).
3. **Session budget**: `realtimeSpeech.budget` (see
   `RealtimeSpeechServerOptions` above) enforced from
   `response-done` usage accumulation — the orchestrator ends the
   provider session and emits a protocol `error` (code
   `BUDGET_EXCEEDED`) or hook callback. This is the lever the pipeline
   never needed but realtime pricing demands.
4. Usage metrics: `realtime.tokens.{audio_in,audio_out,text_in,text_out,cached}`
   counters + per-response timing, so operators can alert on spend.
5. Docs ship a cost table comparing pipeline vs relay per 10-minute
   conversation (numbers from the pricing research above).

### 8. Fallback and errors

- If `provider.connect()` fails and pipeline `providers` are
  configured, the server falls back to pipeline mode for that session
  (logged + hook + `ready.mode: 'pipeline'`), making rollouts safe.
- Recoverable session errors (Gemini reconnect-with-resumption) are
  invisible to the client apart from a possible sub-second audio gap.
- Non-recoverable errors surface as protocol `error` + session end;
  the client's existing reconnect logic then re-establishes a session.

## Phasing

| Milestone | Deliverable |
|---|---|
| M1 | Core interfaces + `OpenAIRealtimeSpeechProvider` + relay orchestrator: audio both ways, transcripts, barge-in. Mock-WS unit tests + live probe. |
| M2 | Tool bridging via ToolRegistry/ToolExecutor; usage events + metrics; cost budget. |
| M3 | Playbook stage mapping; protocol/web-client extensions; docs + tutorial. |
| M4 | `GeminiLiveSpeechProvider` (reconnection/resumption, compression); cross-provider conformance test suite over the mock servers. |
| M5 | Hardening: watchdogs everywhere, fallback path, load/soak test, cost documentation. |

Each milestone lands behind the same regression gates as Phases 1–5
(unit + live integration + review) and is independently shippable.

## Alternatives considered

1. **Client-direct provider connection (ephemeral tokens, provider
   WebRTC)**: lowest possible latency (one less hop) and no server
   audio relay cost. Rejected for v1 because tool execution, playbook
   state, budget enforcement, and provider-key custody all live
   server-side in LLMRTC's model; both providers' token-minting flows
   (`POST /v1/realtime/client_secrets`, Gemini `auth_tokens.create`)
   are noted as a future `mode: 'client-direct'` where the server mints
   tokens and handles tool calls over a data channel.
2. **Emulating S2S with tighter pipeline (streaming STT → streaming LLM
   → streaming TTS with sentence pipelining)**: already largely built
   (Phases 3–4); reduces but cannot close the latency gap and loses
   prosody preservation. Kept as the default mode.
3. **One orchestrator for both modes**: rejected; the turn state
   machines are fundamentally different (server-driven turns vs
   provider-driven), and forcing them through `TurnOrchestrator` would
   contort both.

## Open questions

1. Should relay mode expose *text input* (client sends typed message →
   `conversation.item.create` / `realtimeInput.text`)? Cheap to add;
   leaning yes in M3.
2. Voice normalization: provider voice ids differ (OpenAI `marin`,
   `cedar`...; Gemini `Kore`...). Pass-through strings (as TTS does
   today) vs a mapping layer — leaning pass-through.
3. Whether to run the local VAD in relay mode for `speech-start`
   protocol parity when the provider's VAD is slow to emit
   `user-speech-started` (OpenAI emits it reliably; Gemini has no
   explicit event, inferred from `interrupted`/activity). M1 will
   measure.
4. History export: pipeline sessions accumulate `Message[]` history
   reusable on reconnect; relay mode's history lives provider-side.
   Mirroring transcripts into session history for continuity across
   provider sessions (and for the fallback path) — leaning yes, from
   transcript events.

## Security

Explicitly deferred to the dedicated security pass. Known items to
carry there: provider key custody in relay config, ephemeral-token
minting endpoint exposure, transcript PII in usage/metrics events, and
abuse limits on session duration/budget defaults.
