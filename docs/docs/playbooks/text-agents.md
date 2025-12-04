---
title: Text Agents with Playbooks
---

`PlaybookOrchestrator` lets you use playbooks in plain text/chat settings (no audio). It handles the tool loop, stage transitions, and history management.

## 1. Setup

```ts
import {
  PlaybookOrchestrator,
  ToolRegistry,
  defineTool,
  type Playbook
} from '@metered/llmrtc-core';
import { OpenAILLMProvider } from '@metered/llmrtc-provider-openai';

const llm = new OpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini'
});

const tools = new ToolRegistry();
// tools.register(defineTool(...));

const playbook: Playbook = /* define stages + transitions */;

const orchestrator = new PlaybookOrchestrator(llm, playbook, tools, {
  maxToolCallsPerTurn: 10,
  phase1TimeoutMs: 60_000,
  llmRetries: 3,
  historyLimit: 50,
  debug: true
});
```

## 2. Single-turn execution

Use `executeTurn` when you want a simple request/response per turn.

```ts
const userInput = 'I want to check my order 12345';

const result = await orchestrator.executeTurn(userInput);

console.log('Assistant:', result.response);
console.log('Tool calls this turn:', result.toolCalls.length);
console.log('Transitioned?', result.transitioned, '→', result.newStage?.id);
```

`TurnResult` includes:
- `response` – final assistant text.
- `toolCalls` – `{ request, result }[]` for tools executed.
- `transitioned` / `transition` / `newStage` – what changed.
- `llmResponses` – raw `LLMResult[]` from Phase 1.
- `stopReason` – final LLM stop reason.

## 3. Streaming responses

Use `streamTurn` for streaming LLM output + visibility into tool calls:

```ts
for await (const event of orchestrator.streamTurn('Book a table for 2')) {
  if (event.type === 'tool_call') {
    const call = event.data; // ToolCallRequest
    console.log('Tool requested:', call.name, call.arguments);
  } else if (event.type === 'content') {
    const chunk = event.data as string;
    process.stdout.write(chunk);
  } else if (event.type === 'done') {
    const turn = event.data; // TurnResult
    console.log('\nTurn complete in stage:', turn.newStage?.id ?? 'unchanged');
  }
}
```

## 4. Hooks and metrics

Playbooks integrate with `PlaybookHooks` (stage enter/exit, transitions, completion) and metrics (`llmrtc.playbook.*`). See **Core SDK → Hooks & Metrics** for details.

## 5. When to use PlaybookOrchestrator vs ConversationOrchestrator

- Use **ConversationOrchestrator** for simple, single-prompt assistants where tools are optional but you don’t need stages.
- Use **PlaybookOrchestrator** when you want:
  - Multiple named stages with different prompts/tools.
  - Rich tool loops and transition rules.
  - Higher-level analytics (stage durations, transitions).

For voice, `VoicePlaybookOrchestrator` wraps PlaybookOrchestrator and adds STT/TTS and client events (see next page).
