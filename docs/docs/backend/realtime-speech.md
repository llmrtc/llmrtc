---
title: Realtime Speech-to-Speech (Experimental)
---

# Realtime Speech-to-Speech Relay

**Experimental.** Instead of the STT → LLM → TTS pipeline, a session in
**realtime relay mode** connects directly to a native speech-to-speech
model (OpenAI `gpt-realtime-2.1` family) over the provider's WebSocket.
The model hears the user's actual voice and answers with generated
speech in ~300–500ms, handles interruptions natively, and preserves
prosody — while LLMRTC keeps providing the WebRTC transport, tool
registry, playbooks, client protocol, and metrics.

Design details live in
[RFC 0001](https://github.com/llmrtc/llmrtc/blob/main/rfcs/0001-realtime-speech-to-speech.md).

## When to use which mode

| | Pipeline (default) | Realtime relay |
|---|---|---|
| Latency | ~800–1500ms | ~300–500ms |
| LLM choice | Any provider (Claude, GLM, local…) | The realtime model |
| Cost | Text-token pricing | Audio-token pricing (~10x) |
| Transcripts | Always | Optional (billed separately) |

## Providers

| Provider | Model | Status |
|---|---|---|
| `OpenAIRealtimeSpeechProvider` | `gpt-realtime-2.1` (default), `-mini` | Live-verified |
| `GeminiLiveSpeechProvider` | `gemini-3.1-flash-live-preview` | Experimental (Gemini Live is a Google preview API); conformance-tested against the documented wire format |

Gemini notes: ~10-minute socket lifetimes are handled inside the adapter
with session resumption and bounded input buffering, so reconnects don't
clip user speech; barge-in is provider-driven; stage instruction updates
use a system text turn, tool-set changes a resumption reconnect.

## Setup (library mode)

```typescript
import { LLMRTCServer, OpenAIRealtimeSpeechProvider } from '@llmrtc/llmrtc-backend';

const server = new LLMRTCServer({
  realtimeSpeech: {
    provider: new OpenAIRealtimeSpeechProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    voice: 'marin',
    budget: { maxSessionMs: 30 * 60 * 1000 }  // default: 120 minutes
  },
  systemPrompt: 'You are a concise voice assistant.',
  toolRegistry  // optional: tools work natively in relay mode
});

await server.start();
```

`providers` becomes optional when `realtimeSpeech` is set. Relay mode
requires the WebRTC audio track (no base64-audio fallback), and
`streamingSTT`/`streamingTTS` are ignored.

## What clients receive

The existing protocol carries relay sessions — old clients keep
working. New additive events on the web client:

```typescript
client.on('transcript', (text, isFinal) => {});          // user speech
client.on('assistantTranscript', (text, isFinal) => {}); // assistant speech (new)
client.on('usage', (usage) => {});                       // per-response tokens (new)
client.on('modeChanged', (mode) => {});                  // reserved: mid-session fallback ships in a later milestone
```

`ready.mode` reports `'realtime'` or `'pipeline'`.

## Tools and playbooks

The same `ToolRegistry` definitions drive the realtime model's native
function calling — no changes to tool code. With a `playbook`
configured, stage transitions reconfigure the live session's
instructions and tools, and `stage-change` events reach the client as
in pipeline mode.

## Interruptions, budgets, renewal

- **Barge-in**: reaction is bounded by design — server-side playback
  clears within ~10ms of the interruption signal regardless of how much
  of the answer was already generated (end-to-end adds network and
  client playout latency), and the provider's history is truncated to
  what the user actually heard.
- **Budgets**: `budget.maxSessionMs` (default 120 minutes) and
  `budget.maxTokens` end or warn on runaway sessions
  (`BUDGET_EXCEEDED`).
- **60-minute cap**: OpenAI realtime sessions expire after an hour; the
  relay renews automatically by seeding a fresh session from the
  conversation transcripts.
- **Reconnects**: a dropped client has 30 seconds
  (`clientReconnectGraceMs`) to reconnect to the same live conversation
  before the provider session closes.

## Fallback behavior

With pipeline `providers` configured alongside `realtimeSpeech`, a
session whose provider connection fails at setup starts in pipeline
mode instead (`ready.mode: 'pipeline'`). A mid-session provider failure
sends `mode-changed {mode: 'pipeline'}` (advisory) and ends the
connection; the client's auto-reconnect lands on the fallback **if the
provider is still unreachable** — otherwise the session resumes in
realtime mode. `ready.mode` is authoritative. Without pipeline
providers, failures surface as `REALTIME_ERROR`.

## Scale notes

Each relay session holds one provider WebSocket, streams ~43–64KB/s of
base64 audio upstream continuously (16kHz Gemini / 24kHz OpenAI), and
runs a 100Hz playback pacer. Provider-side, audio tokens-per-minute
limits — not concurrent-session caps — are the binding constraint. New
sessions scale any-node; reconnect recovery (the grace window, session
history) is node-local, so keep load-balancer affinity at least as long
as `clientReconnectGraceMs` if seamless reconnects matter.

## Cost warning

Realtime audio pricing is roughly an order of magnitude above an
equivalent pipeline: at `gpt-realtime-2.1` rates, a 10-minute
conversation runs ~$0.50–0.90 (cache-warm). `gpt-realtime-2.1-mini`
costs ~1/3 of that. Input transcription (on by default) bills
separately at the transcription model's rate. Set budgets in
production.
