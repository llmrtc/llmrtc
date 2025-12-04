---
title: Voice Playbook Mode
---

`VoicePlaybookOrchestrator` combines the speech pipeline (VAD → STT → LLM → TTS) with playbook stage logic. Use it when you want multi-stage workflows plus voice UX.

## When to use
- Support or sales flows with clear stages (greeting → auth → triage → resolution).
- Tool-heavy assistants where stage changes depend on tool results.
- You want stage-change events in the client UI.

## How to enable (backend)
```ts
import { LLMRTCServer, ToolRegistry, type Playbook } from '@metered/llmrtc-backend';

const playbook: Playbook = /* define stages + transitions */;
const tools = new ToolRegistry();
// tools.register(defineTool(...))

const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  playbook,
  toolRegistry: tools,
  playbookOptions: {
    maxToolCallsPerTurn: 10,
    phase1TimeoutMs: 60000,
    debug: false
  }
});
```

For advanced use cases you can also construct `VoicePlaybookOrchestrator` directly and plug it into your own server, but the recommended path is to let `LLMRTCServer` create and manage it via `playbook` + `toolRegistry`.

## Client events
- `stageChange` `{ from, to, reason }`
- `toolCallStart` / `toolCallEnd`
Use these to render current stage, history, and in-flight tools.

## Two-phase turns
Voice playbooks use two-phase execution by default (tool loop then final reply) to keep responses concise while still allowing tool calls.

## Metrics & logging
Stage enter/exit and transitions emit through hooks; pair with your metrics adapter to track drop-off and duration per stage.
