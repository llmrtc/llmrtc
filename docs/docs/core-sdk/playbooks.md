---
title: Playbooks API
---

Playbooks orchestrate staged flows with tool calls and custom prompts per stage.

- Define a playbook with named stages and transitions.
- Register it with the backend so clients can opt into playbook mode.
- Listen for `stage-change` events to drive UI (e.g., form steps).

Patterns
- Slot filling: gather required fields stage by stage.
- Multi-intent: route to specialized sub-playbooks based on detected intent.
- Human handoff: transition to a `handoff` stage that notifies an agent.

### Example (condensed)

```ts
import { Playbook } from '@metered/llmrtc-core';

export const supportPlaybook: Playbook = {
  id: 'support',
  initialStage: 'greeting',
  globalSystemPrompt: 'You are a concise support agent.',

  stages: [
    { id: 'greeting', systemPrompt: 'Greet and ask the issue.' },
    { id: 'triage', systemPrompt: 'Clarify the issue, collect order id.', tools: [lookupOrder.definition] },
    { id: 'resolution', systemPrompt: 'Resolve or escalate.' },
    { id: 'farewell', systemPrompt: 'Close politely.' }
  ],

  transitions: [
    { id: 'start-triage', from: 'greeting', condition: { type: 'keyword', keywords: ['order', 'refund', 'broken'] }, action: { targetStage: 'triage' } },
    { id: 'resolved', from: 'triage', condition: { type: 'tool_result', toolName: 'lookup_order', check: (r) => r.success }, action: { targetStage: 'resolution' } },
    { id: 'wrapup', from: '*', condition: { type: 'llm_decision' }, action: { targetStage: 'farewell' } }
  ]
};
```

### Transition types (built in)
- `keyword` – match keywords in assistant text.
- `tool_call` / `tool_result` – fire when a specific tool is invoked or succeeds.
- `llm_decision` – LLM calls the built-in `playbook_transition` tool to request a move.
- `max_turns` / `timeout` – safety valves for stuck stages.
- `intent` – intent classification based transitions.
- `custom` – user-supplied function.

### Validation
Use `validatePlaybook(playbook)` to catch missing stages, bad IDs, or invalid transitions at startup.

### Two-phase turns
Playbooks default to two phases: Phase 1 (tool loop) then Phase 2 (final reply). You can disable per stage with `twoPhaseExecution: false` when you only want a single pass.

### Voice playbooks
`VoicePlaybookOrchestrator` (backend) layers speech/VAD handling on top of playbooks and emits `stage-change` events to the client. See Backend → Voice Playbook for wiring details.

### Metrics & hooks
Playbook hooks emit stage enter/exit, transitions, and per-stage durations. Pair with a `MetricsAdapter` to get `llmrtc.playbook.*` metrics (see Hooks & Metrics page).
