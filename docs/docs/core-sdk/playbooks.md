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
    { id: 'greeting', name: 'Greeting', systemPrompt: 'Greet and ask the issue.' },
    { id: 'triage', name: 'Triage', systemPrompt: 'Clarify the issue, collect order id.', tools: [lookupOrder.definition] },
    { id: 'resolution', name: 'Resolution', systemPrompt: 'Resolve or escalate.' },
    { id: 'farewell', name: 'Farewell', systemPrompt: 'Close politely.' }
  ],

  transitions: [
    { id: 'start-triage', from: 'greeting', condition: { type: 'keyword', keywords: ['order', 'refund', 'broken'] }, action: { targetStage: 'triage' } },
    { id: 'resolved', from: 'triage', condition: { type: 'tool_call', toolName: 'lookup_order' }, action: { targetStage: 'resolution' } },
    { id: 'wrapup', from: '*', condition: { type: 'llm_decision' }, action: { targetStage: 'farewell' } }
  ]
};
```

### Transition Condition Types

| Type | Description |
|------|-------------|
| `keyword` | Match keywords in assistant text |
| `tool_call` | Fire when a specific tool is invoked |
| `llm_decision` | LLM calls the built-in `playbook_transition` tool |
| `intent` | Intent classification based transitions |
| `max_turns` | Transition after N turns in stage |
| `timeout` | Transition after time in stage exceeds duration |
| `custom` | User-supplied evaluate function |

### Validation
Use `validatePlaybook(playbook)` to catch missing stages, bad IDs, or invalid transitions at startup.

### Two-phase turns
Playbooks default to two phases: Phase 1 (tool loop) then Phase 2 (final reply). You can disable per stage with `twoPhaseExecution: false` when you only want a single pass.

### Voice playbooks
`VoicePlaybookOrchestrator` (backend) layers speech/VAD handling on top of playbooks and emits `stage-change` events to the client. See Backend → Voice Playbook for wiring details.

### Metrics & hooks
Playbook hooks emit stage enter/exit, transitions, and per-stage durations. Pair with a `MetricsAdapter` to get `llmrtc.playbook.*` metrics (see Hooks & Metrics page).
