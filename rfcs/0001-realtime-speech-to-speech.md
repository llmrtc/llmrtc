# RFC 0001: Realtime Speech-to-Speech Orchestrator Mode

- **Status**: Draft (rev 2)
- **Created**: 2026-07-11
- **Revised**: 2026-07-11 — after an adversarial design audit and an
  independent fact-check of all provider API claims. Major changes:
  decoupled playback pipeline (§3), session lifetime and renewal for
  both providers (§8), barge-in state machine and error taxonomy (§4),
  client-reconnect semantics (§9), operational concerns (§10), testing
  strategy (§11).
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
$10/$20) and Gemini (audio in $3/M, out $12/M) narrow the gap. Cost
controls are therefore a first-class design concern (§7 Cost controls),
not an afterthought.

Two footnotes for operators: those figures assume the automatic audio
prompt cache is warm — the first minutes of a session run uncached and
cost more; and enabling input transcription (§2) bills separately at
the transcription model's rate (~$0.006/min for whisper-class models),
on top of realtime audio tokens.

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
5. **Responsive barge-in**: interruption reaction is bounded by design
   (§3's playback decoupling), independent of response length.
6. **Observability**: hooks and metrics parity (turn timings, token
   usage per response, interruption counts, barge-in reaction time).

## Non-goals

- Client-direct provider connections via ephemeral tokens (documented
  as a future option; see Alternatives).
- Telephony/SIP transport.
- Security hardening details (tracked separately in the security pass).
- Vision/video input to realtime models (both APIs support image/video
  input; deferred to keep v1 scoped to audio). Client `attachments`
  messages received in relay mode are dropped with a server-side
  warning in v1.
- Manual turn detection. A `commitTurn()`-style API is deferred until a
  concrete consumer exists; v1 supports provider VAD only (§1).

## Background: current architecture

Today `LLMRTCServer` owns a per-connection `NativePeerServer`
(RTCAudioSink/Source, 48kHz PCM), an `AudioProcessor` (Silero VAD;
buffered utterances, or live frames in streaming-STT mode), and a
`TurnOrchestrator` (simple or playbook) that runs STT → LLM → TTS and
yields protocol events that `handleAudio` relays to the client
(`transcript`, `llm-chunk`, `tts-start`/`tts-chunk`/`tts-complete`,
`tts-cancelled`). TTS PCM is fed to the client through a paced PCM
feeder onto the WebRTC audio track (`feedPCMChunkToSource`, which
paces 10ms frames against a wall-clock schedule and takes the source
rate via its `inputSampleRate` option).

Relay mode replaces the *turn machinery* (VAD-triggered turns, STT,
LLM, TTS) but keeps the *transport and protocol layer* (peer, PCM
feeder, WebSocket signaling, session manager, hooks). One property of
the feeder is load-bearing for this design and called out early:
**providers generate audio faster than realtime** (a 15-second answer
can arrive in 2–4 seconds), while the feeder deliberately plays it out
at realtime pace. Anything queued behind undelivered audio waits for
wall-clock playback — which is why control events must never share a
queue with audio (§3).

## Design

### 1. Provider abstraction (`@llmrtc/llmrtc-core`)

```ts
export interface RealtimeSpeechConfig {
  instructions?: string;              // system prompt
  voice?: string;                     // provider voice id (pass-through)
  tools?: ToolDefinition[];           // same defs as pipeline mode
  /**
   * Emit user-transcript events (default true). Note: input
   * transcription is a separate transcription-model pass billed on top
   * of realtime audio tokens (see §7).
   */
  inputTranscription?: boolean;
  /** Transcription model for user transcripts (default: 'gpt-4o-mini-transcribe' on OpenAI; Gemini transcribes natively). */
  transcriptionModel?: string;
  turnDetection?:                     // provider-native VAD tuning
    | { type: 'server_vad'; silenceDurationMs?: number; thresholdOverride?: number }
    | { type: 'semantic'; eagerness?: 'low' | 'medium' | 'high' | 'auto' };
  maxOutputTokens?: number;
  contextManagement?: {               // cost lever, provider-mapped
    strategy: 'truncate' | 'compress';
    retentionRatio?: number;          // OpenAI truncation
    triggerTokens?: number;           // Gemini compression
  };
}

export interface RealtimeUsage {
  inputTokens: number;
  outputTokens: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  cachedTokens?: number;
}

/** Events pushed by the provider session. */
export type RealtimeSpeechEvent =
  | { type: 'audio'; pcm: Buffer; sampleRate: number; responseId: string; itemId?: string }
  | { type: 'user-transcript'; text: string; isFinal: boolean }
  | { type: 'assistant-transcript'; text: string; isFinal: boolean }
  | { type: 'user-speech-started' }                              // barge-in signal (OpenAI; not emitted by Gemini)
  | { type: 'response-started'; responseId: string }
  | { type: 'response-done'; responseId: string; usage?: RealtimeUsage }
  | { type: 'tool-call'; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool-call-cancelled'; callIds: string[] }           // Gemini interruption
  | { type: 'interrupted' }                                      // provider-driven barge-in
  | { type: 'session-expiring'; inMs?: number }                  // BOTH providers: Gemini goAway; OpenAI expires_at timer (§8)
  | { type: 'error'; error: Error; recoverable: boolean };

export interface RealtimeSpeechSession {
  /** PCM rate the session expects from sendAudio (16k Gemini, 24k OpenAI). */
  readonly inputSampleRate: number;
  /** PCM rate of emitted 'audio' events (24k for both targets). */
  readonly outputSampleRate: number;
  events(): AsyncIterable<RealtimeSpeechEvent>;   // AsyncEventQueue-backed
  /**
   * Fire-and-forget. During an adapter-internal reconnect (§2 Gemini,
   * §8 renewal) frames are buffered (bounded, ~2s) and replayed after
   * the session is re-established, so user speech spanning a reconnect
   * is not clipped. Frames beyond the buffer bound are dropped with a
   * metric.
   */
  sendAudio(frame: Buffer): void;
  /**
   * Cancel the in-progress response, if any. The adapter tracks the
   * active response id, current audio item id/content index, and
   * per-item played-ms internally (§4); calling this with no active
   * response is a safe no-op. playedMs trims provider-side history to
   * the audio the user actually heard (OpenAI truncate).
   */
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
  `AsyncEventQueue`) for **control** purposes. The orchestrator's event
  loop must treat it as a control channel: `audio` events are moved
  synchronously into the playback queue (§3) and never awaited through
  the pacer. Ordering between control events stays trivial; audio
  delivery is decoupled.
- `audio` events carry `responseId` (and `itemId` where the provider
  has one) so stale deltas of a cancelled response can be identified
  and dropped (§3, §4).
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
  (`server_vad` | `semantic_vad` with eagerness). When
  `inputTranscription` is on, `audio.input.transcription = {model:
  transcriptionModel}` (default `gpt-4o-mini-transcribe`).
- Event mapping: `response.output_audio.delta` → `audio` (24kHz,
  tagged with the response/item ids from the event);
  `conversation.item.input_audio_transcription.delta/completed` →
  `user-transcript`; `response.output_audio_transcript.delta/done` →
  `assistant-transcript`; `input_audio_buffer.speech_started` →
  `user-speech-started`; `response.created` → `response-started`;
  `response.done` → `response-done` with usage;
  `response.function_call_arguments.done` → `tool-call`.
- **Session lifetime: 60 minutes, hard cap.** `session.created` carries
  `expires_at`; the adapter emits `session-expiring` on a timer ahead
  of it (default 5 minutes before). OpenAI has no session resumption —
  renewal is reseed-from-transcripts (§8).
- `cancelResponse(playedMs)` → `response.cancel` +
  `conversation.item.truncate {item_id, content_index, audio_end_ms}`
  using the adapter's tracked current-audio-item state; `audio_end_ms`
  is clamped to the item's frames-received duration so truncate can
  never exceed the item's real audio (the API rejects overshoot). The
  documented `response_cancel_not_active` race error is swallowed as
  benign (§4 error taxonomy).
- `sendToolResult` → `conversation.item.create {type:
  "function_call_output", call_id, output: JSON.stringify(output)}` +
  `response.create`.
- Cost levers: `session.max_output_tokens`; `session.truncation
  {type:"retention_ratio", retention_ratio}`. Audio input caching is
  automatic (cached audio input $0.40/M ≈ 99% off, once warm).
- Default model `gpt-realtime-2.1`; `gpt-realtime-2.1-mini` documented
  as the cost-sensitive choice. Watchdogs per §10 (connect timeout
  yes; **no** inactivity timeout on a healthy session — user silence
  is normal in a long-lived session, unlike Phase 4's per-utterance
  sockets).

**`GeminiLiveSpeechProvider`** (`@llmrtc/llmrtc-provider-google`):

- Connect `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;
  first message `setup` with model (default
  `gemini-3.1-flash-live-preview`), `generationConfig.responseModalities:
  ["AUDIO"]`, `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`,
  `systemInstruction`, `tools`, `inputAudioTranscription: {}`,
  `outputAudioTranscription: {}`, `realtimeInputConfig` (VAD mapping),
  `contextWindowCompression {slidingWindow: {}, triggerTokens}`, and
  `sessionResumption`.
- Audio in: `realtimeInput.audio {data, mimeType: "audio/pcm;rate=16000"}`
  (16kHz in); out: `serverContent.modelTurn.parts[].inlineData` (24kHz
  PCM) → `audio` (tagged with a per-turn synthetic responseId).
  `serverContent.interrupted` → `interrupted`;
  `toolCall.functionCalls` → `tool-call`; `toolCallCancellation` →
  `tool-call-cancelled`; `inputTranscription`/`outputTranscription` →
  transcript events; `goAway.timeLeft` → `session-expiring`.
  **Gemini emits no `user-speech-started`** — barge-in is
  provider-driven via `interrupted` (§4), and the client `speech-start`
  message is not sent in Gemini relay sessions unless the optional
  local VAD is enabled for parity (§10).
- **Session lifetime**: ~10-minute WebSocket lifetime, 15-minute audio
  session cap without compression. The adapter owns reconnection: on
  `goAway` (or socket loss) it reconnects with the stored
  `sessionResumptionUpdate.newHandle`. **During the reconnect window
  the adapter buffers incoming `sendAudio` frames (bounded, ~2s) and
  replays them after `setupComplete`**, so a user speaking across the
  gap is not clipped; frames beyond the bound are dropped with a
  metric. Resumption handles arrive periodically — reconnects restore
  state as of the last received handle, and a reconnect requested
  before any handle exists starts a fresh session (logged). Context
  window compression is enabled by default in relay mode to lift the
  15-minute cap.
- `update()`: Gemini's setup is connect-time only. For
  **instruction-only** changes the adapter uses the documented cheaper
  path — sending system-role text content mid-session, no reconnect.
  For **tool-set** changes it reconnects with session resumption,
  sequenced as: deliver pending tool results → wait for generation
  quiescence (no active model turn) → reconnect. Behavior of a pending
  `toolCall` across resumption is undocumented upstream; the M4 live
  probe must characterize it before playbook-on-Gemini ships.
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
    maxSessionMs?: number;            // default 120 minutes
    maxTokens?: number;
    onExceeded?: 'warn' | 'end-session';
  };
  /** Keep the provider session alive across client reconnects (§9). Default 30s; 0 disables. */
  clientReconnectGraceMs?: number;
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
  providers: { ... }     // optional pipeline fallback (see §9)
});
```

Config surface changes: when `realtimeSpeech` is set, `providers`
becomes **optional** (it is required today) and is used only as the
pipeline fallback; `streamingSTT`/`streamingTTS` are ignored with a
one-time warning. Relay mode requires the WebRTC audio track — the
legacy base64 `audio` WebSocket message is rejected with a protocol
error in relay sessions (there is no buffered-turn path to hand it
to).

#### Dataflow: control loop, playback queue, pacer

The audit's central finding: providers generate audio **faster than
realtime**, and the PCM feeder plays it at wall-clock pace. A single
loop that awaits the feeder would trap control events (barge-in, tool
calls, response-done) behind seconds of undelivered audio — barge-in
reaction time would equal the remaining response length. The design
therefore separates three concerns:

1. **Control loop** — one `for await` over `session.events()`. It never
   awaits playback. `audio` events are *synchronously* appended to the
   playback queue (tagged with their `responseId` and the current
   **playback epoch**); every other event is handled immediately
   (protocol messages, tool execution dispatch, hooks/metrics).
2. **Playback queue + pacer** — a per-session queue drained by an
   independent pacer task that feeds 10ms frames to the existing PCM
   feeder at wall-clock cadence and maintains the per-item
   **frames-fed clock** (the played-ms basis, §4). The pacer is the
   only component that sleeps.
3. **Barge-in path** — clearing playback is a synchronous operation:
   bump the epoch, drop the queue, notify. Late `audio` deltas of a
   cancelled response (OpenAI keeps delivering in-flight deltas after
   `response.cancel`) carry a stale responseId/epoch and are dropped on
   arrival in the control loop.

Per connection:

1. **Eager connect**: `provider.connect()` starts at WebSocket accept,
   concurrent with ICE-server resolution; the protocol `ready` message
   waits for both and carries the true `mode: 'realtime' | 'pipeline'`
   (fallback applies if connect fails, §9). This adds one provider
   handshake (~100–300ms) to `ready` latency; if the provider session
   dies later and fallback engages mid-session, the server emits the
   new `mode-changed` message (§6).
2. **Upstream audio**: `peer.on('audioData')` frames (48kHz Int16) are
   resampled to `session.inputSampleRate` by extending the
   `AudioProcessor` tee (Phase 4 infrastructure; its resampler is
   already generic-rate) with a pass-through mode that streams *all*
   frames unconditionally — turn detection is provider-side. Frames go
   straight to `session.sendAudio()`.
3. **Downstream audio**: the pacer feeds the PCM feeder
   (`inputSampleRate` option = `session.outputSampleRate`) onto the
   TTS track — the same path pipeline TTS uses, so client playback
   code is unchanged.
4. **Teardown** mirrors Phase 4 rules: peer/ws close ends the upstream
   feed and (after the reconnect grace window, §9) closes the provider
   session; watchdogs prevent leaks.

Event → protocol mapping:

| Session event | Protocol message | Notes |
|---|---|---|
| `user-transcript` | `transcript {text, isFinal}` | identical to pipeline |
| `assistant-transcript` | `assistant-transcript {text, isFinal}` | **new message type** |
| first `audio` of a response | `tts-start` | gated on first audio delta, not `response-started`, so text-only/tool responses (§5) produce no phantom tts cycle |
| `audio` | (audio track via playback queue) | no protocol message |
| `response-done` | `tts-complete` + `usage` event | usage is **new**; tts-complete only if audio was started |
| `user-speech-started` | `speech-start` + barge-in (§4) | OpenAI only |
| `interrupted` | `tts-cancelled` + playback clear | Gemini barge-in |
| `tool-call` / result | `tool-call-start` / `tool-call-end` | existing playbook messages |
| `tool-call-cancelled` | `tool-call-end {error: 'cancelled'}` per id | aborts in-flight executor calls |
| `session-expiring` | none (internal) | triggers renewal (§8); `onSessionExpiring` hook |
| `error` (fatal) | `error {code: REALTIME_ERROR}` | benign/recoverable errors do not reach the client (§4) |

**Transcript mirroring (required)**: final `user-transcript` and
`assistant-transcript` events are appended to the session's `Message[]`
history as they arrive. This history is what makes OpenAI session
renewal (§8), client-reconnect reseeding (§9), and pipeline fallback
(§9) possible; it also keeps `SessionManager` semantics meaningful in
relay mode. `Session.orchestrator` typing widens to
`TurnOrchestrator | RealtimeRelayOrchestrator` (both expose the small
surface SessionManager actually uses: history access and disposal).

### 4. Barge-in mapping

The two providers invert responsibility, normalized over the §3
playback machinery. The adapter maintains a small state machine:
**active response id**, **current output audio item id/content
index**, and the **per-item frames-fed clock** (from the pacer; reset
per item).

- **OpenAI (client-driven)**: on `user-speech-started` **while a
  response is active and audio has been fed** (both conditions checked
  against adapter state — a speech-start during tool execution or
  racing `response.done` triggers nothing), the orchestrator
  synchronously (a) clears the playback queue and bumps the epoch,
  (b) sends `tts-cancelled` to the client, (c) calls
  `session.cancelResponse(playedMs)` with the per-item frames-fed
  value. With `semantic_vad` + `interrupt_response: true` the provider
  self-cancels; the orchestrator still clears and notifies.
- **Gemini (server-driven)**: `interrupted` arrives from the provider;
  the orchestrator clears playback and sends `tts-cancelled`. Pending
  `tool-call-cancelled` ids abort in-flight executor calls via their
  `AbortSignal`.

**Played-ms accuracy**: the frames-fed clock counts audio actually
handed to the WebRTC track, which *leads* what the user has heard by
encode + network + jitter-buffer + playout (~50–250ms typical; more on
bad networks; unbounded if the client muted its speaker). Truncating a
few syllables long is the industry-standard best effort and the cost of
being wrong is small (slightly generous provider-side history). A
future refinement — client playout-position reports over the data
channel — is noted, not designed.

**Provider-error taxonomy** (replaces the blanket error mapping):

| Class | Examples | Handling |
|---|---|---|
| Benign race | `response_cancel_not_active`, truncate on just-completed item | swallow + `realtime.races` metric |
| Recoverable | Gemini socket loss with resumption handle, transient send failure | adapter handles (§2); `onSessionRecovered` hook |
| Fatal | auth failure, unsupported config, renewal failure | protocol `error {REALTIME_ERROR}` + session end (§9) |

The local Silero VAD is **not** used for turn-taking in relay mode but
can optionally run for `speech-start` parity and metrics (§10).

### 5. Tools and playbooks

- **Tools**: `ToolRegistry` definitions map 1:1 to both providers'
  function schemas (both accept JSON Schema parameters). `tool-call`
  events run through the existing `ToolExecutor` (timeouts, error
  wrapping, hooks, `AbortSignal` support preserved); results return via
  `sendToolResult`. Parallel calls: OpenAI emits sequential
  `function_call` items within a response; Gemini can batch
  `functionCalls` — the orchestrator executes with the same concurrency
  semantics as the pipeline's two-phase executor.
- **Tool phase is naturally silent (primary design)**: a realtime
  response that emits `function_call` items produces no audio for those
  items. The natural flow — model calls tools, orchestrator returns
  outputs, `response.create` yields the spoken answer — already gives a
  silent tool loop for the common case, with no session gymnastics.
  The previous draft's text-only tool phase
  (`response.create {output_modalities:["text"]}`, which the GA API
  does support per-response) is **demoted to an optional
  strict-silence variant** because it requires `turn_detection.create_response:
  false` plus orchestrator-driven response creation on speech-stopped,
  and its "spoken answer" is a second generation — duplicate history,
  ~2× output tokens, doubled time-to-first-audio. If implemented, those
  requirements and costs must be documented with it.
- **Playbooks**: stages map to `session.update({instructions, tools})`
  (Gemini: system-text for instruction-only changes, reconnect for
  tool-set changes — §2). The `PlaybookEngine` (stage state machine,
  transition rules) is reused; what changes is the *effect* of a
  transition — instead of altering the next LLM request, it
  reconfigures the live session. LLM-decision transitions are
  implemented by exposing the internal `playbook_transition` tool to
  the realtime model, identical to pipeline mode. Stage `onEnter`
  announcements are delivered as a `response.create` with stage
  instructions (OpenAI) or a text `realtimeInput` nudge (Gemini).
  Gemini native-audio models only support AUDIO out, so playbooks on
  Gemini run single-phase (documented limitation).

### 6. Protocol extensions (additive)

- `ready` gains `mode: 'pipeline' | 'realtime'` (the *actual* mode,
  post-connect — §3).
- New server→client messages: `assistant-transcript {text, isFinal}`,
  `usage {inputTokens, outputTokens, audioInputTokens, audioOutputTokens, cachedTokens}`,
  `mode-changed {mode: 'pipeline'}` (mid-session fallback, §9).
- Web client: new events `assistantTranscript(text, isFinal)`,
  `usage(usage)`, and `modeChanged(mode)`; current clients ignore
  unrecognized message types (verified: `handlePayload`'s switch takes
  no action on unmatched types, and the message schema passes unknown
  types through), so old clients degrade gracefully. Caveat: user code
  that validates raw messages with the exported `parseMessage()` will
  reject the new types until it upgrades to a core version that
  includes them — noted in the migration docs.
- New protocol error codes: `REALTIME_ERROR`, `BUDGET_EXCEEDED` (added
  to the `ErrorCode` union).

### 7. Cost controls

1. `maxOutputTokens` per response (both providers). This is the bound
   that makes per-response accounting sufficient: usage arrives only at
   `response-done`, so the per-response cap is what prevents a single
   runaway response from blowing the session budget between accounting
   points.
2. Context: OpenAI `truncation.retention_ratio` (default 0.8 in relay
   mode); Gemini `contextWindowCompression` (default on).
3. **Session budget**: `realtimeSpeech.budget` (§3) enforced from
   `response-done` usage accumulation and wall-clock. Defaults are
   deliberately not unbounded: `maxSessionMs` defaults to **120
   minutes** (override or set 0 to disable). `'end-session'` executes
   as: cancel any active response → clear playback → `tts-cancelled` →
   protocol `error {code: BUDGET_EXCEEDED}` → close the provider
   session. Queued audio does not finish playing.
4. Input transcription is billed separately (~$0.006/min whisper-class)
   and is on by default for protocol parity; operators who don't need
   user transcripts can set `inputTranscription: false` (§1).
5. Usage metrics: `realtime.tokens.{audio_in,audio_out,text_in,text_out,cached}`
   counters + per-response timing, so operators can alert on spend.
6. Docs ship a cost table comparing pipeline vs relay per 10-minute
   conversation (cached and uncached regimes).

### 8. Session lifetime and renewal

Both providers cap session length; the strategies differ.

- **OpenAI: 60-minute hard cap, no resumption.** The adapter emits
  `session-expiring` from an `expires_at` timer (default lead: 5
  minutes). The orchestrator's renewal path: open a **new** provider
  session configured with current instructions/tools plus a seed
  digest built from the mirrored transcript history (§3); swap
  sessions at a turn boundary (generation quiescent, no pending tool
  calls); close the old one. The behavioral seam is documented: the
  renewed session has the words but not the audio nuance of the prior
  hour. If renewal fails, fatal-error handling applies (§4, §9).
- **Gemini: ~10-minute sockets, resumable.** Handled inside the
  adapter with resumption handles and input-audio buffering (§2);
  the orchestrator only sees `session-expiring` (from `goAway`) as an
  informational hook.

Renewal count and timing surface as metrics
(`realtime.session.renewals`) and an `onSessionRenewed` hook.

### 9. Fallback, client reconnects, and errors

- **Connect-time fallback**: if `provider.connect()` fails and pipeline
  `providers` are configured, the session starts in pipeline mode
  (`ready.mode: 'pipeline'`, logged + hook). Mid-session fatal errors
  with pipeline configured: the server ends the provider session,
  emits `mode-changed {mode: 'pipeline'}`, and seeds the pipeline
  orchestrator's history from mirrored transcripts (§3). Without
  pipeline providers: protocol `error` + session end; the client's
  existing reconnect logic then re-establishes a session.
- **Client reconnects** (mobile networks; the shipped client
  auto-reconnects): the provider session is kept alive for
  `clientReconnectGraceMs` (default 30s) after client ws/peer loss —
  mic is silent but conversation state survives, at the cost of
  provider session minutes. Reconnect within the window resumes
  seamlessly and `reconnect-ack.historyRecovered` is honestly `true`.
  After the window the provider session closes; a later reconnect gets
  a **new** provider session seeded from mirrored transcripts, and
  `historyRecovered` reflects exactly that (transcript-level recovery,
  not provider-state recovery).
- Recoverable provider blips (Gemini resumption reconnects) are
  invisible to the client apart from a possible sub-second output gap;
  input audio is buffered per §2.

### 10. Operational concerns

- **Idle and keepalive**: user silence is normal in a long-lived
  session — there is **no inactivity watchdog** on a healthy relay
  session (unlike Phase 4's per-utterance STT sockets and their 30s
  watchdog). Liveness is judged by socket health (ws ping/pong) and a
  connect-phase timeout only.
- **Mute / long silence**: client-side mute simply stops meaningful
  frames; the provider VAD hears silence and the session idles at
  input-token cost only. Operators wanting a cap use
  `budget.maxSessionMs`.
- **Scale**: each relay session holds one provider WebSocket,
  continuous ~64KB/s base64-encoded upstream audio, and a 100Hz pacer
  task. Provider-side, audio token-per-minute limits — not concurrent
  session caps — are the binding constraint; the docs will state
  per-tier ceilings and that horizontal scaling is per-connection
  stateless (any node can own a session).
- **Latency measurement**: two first-class metrics, absent from the
  pipeline but essential here: `realtime.response_latency`
  (provider `speech_stopped` → first audio frame fed) and
  `realtime.bargein_reaction` (`user-speech-started`/`interrupted` →
  playback cleared). The RFC's 300–500ms motivation figure is validated
  or corrected by M1's live probe using these metrics.
- **Optional local VAD**: off by default; enabling it restores
  `speech-start` protocol parity on Gemini and provides
  provider-independent barge-in reaction as a diagnostic comparison.

### 11. Testing strategy

- **Mock-WS conformance suite** (per adapter, shared scenario scripts):
  wire-format assertions, event normalization, cancel/truncate state
  machine, stale-delta dropping across epochs, reconnect/resumption
  choreography with scripted `goAway`, renewal-at-expiry choreography.
  Follows the Phase 4 fake-server pattern.
- **Live probes** (scripted audio, real APIs, timing assertions): the
  M1 probe feeds TTS-generated speech, asserts transcripts, measures
  `response_latency` and `bargein_reaction` against budgets (barge-in
  clear ≤ 150ms from signal), and exercises a real interruption
  mid-response. M4 adds the Gemini probe incl. >10-minute session
  (forced resumption) and a pending-tool-call-across-resume
  characterization.
- **Orchestrator unit tests** with a fake `RealtimeSpeechSession`:
  playback-queue epochs, budget enforcement sequences, renewal seams,
  client-reconnect grace, fallback seeding.
- **Soak**: one hour-long session (crossing an OpenAI renewal) under
  synthetic conversation load, asserting no leaks (sockets, timers,
  queue growth).

## Phasing

| Milestone | Deliverable |
|---|---|
| M1 | Core interfaces + `OpenAIRealtimeSpeechProvider` + relay orchestrator with the §3 control/playback/pacer split: audio both ways, transcripts (mirrored into history), barge-in with the §4 state machine. Mock-WS suite + live probe with latency/barge-in budgets. |
| M2 | Tool bridging via ToolRegistry/ToolExecutor; usage events + metrics; cost budget + end-session sequence; OpenAI 60-minute renewal. |
| M3 | Playbook stage mapping (native silent-tool flow); protocol/web-client extensions incl. `mode-changed`; client-reconnect grace; docs + tutorial. |
| M4 | `GeminiLiveSpeechProvider` (resumption reconnection with input buffering, compression, system-text instruction updates); cross-provider conformance suite; Gemini live probe incl. forced resumption. |
| M5 | Hardening: pipeline fallback seeding, soak test (renewal crossing), scale documentation, cost documentation (cached/uncached). |

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
4. **Single-loop dataflow (rev 1 design)**: rejected after audit — a
   control loop that awaits realtime-paced playback delays barge-in by
   the remaining response length. Superseded by §3's decoupled
   playback queue and pacer.

## Open questions

1. Should relay mode expose *text input* (client sends typed message →
   `conversation.item.create` / `realtimeInput.text`)? Cheap to add;
   leaning yes in M3.
2. Voice normalization: provider voice ids differ (OpenAI `marin`,
   `cedar`…; Gemini `Kore`…). Pass-through strings (as TTS does
   today) vs a mapping layer — leaning pass-through.
3. Renewal seed format (§8): raw transcript replay vs a summarized
   digest for long histories — M2 decides against token-cost
   measurements.

*(Resolved since rev 1: transcript mirroring is now required (§3);
local-VAD-for-parity is specified as an off-by-default option (§10);
manual turn detection is deferred out of v1 (Non-goals).)*

## Security

Explicitly deferred to the dedicated security pass. Known items to
carry there: provider key custody in relay config, ephemeral-token
minting endpoint exposure, transcript PII in usage/metrics events and
mirrored history, and abuse limits on session duration/budget defaults.
