---
title: Defining Playbooks
---

Playbooks are plain TypeScript objects that match the `Playbook`, `Stage`, and `Transition` types in `@metered/llmrtc-core` (`packages/core/src/playbook.ts`).

## Stage

A **stage** is a named state with its own prompt, tools, and config.

Key fields (see `Stage` type):
- `id: string` – unique id used by transitions.
- `name: string` – human label.
- `systemPrompt: string` – stage-specific instructions.
- `description?: string` – optional docs.
- `tools?: ToolDefinition[]` – tools available in this stage.
- `toolChoice?: ToolChoice` – `auto | none | required | { name }`.
- `llmConfig?: { temperature?, maxTokens?, topP?, model? }` – per-stage overrides.
- `twoPhaseExecution?: boolean` – default `true`; set `false` to skip Phase 2.
- `maxTurns?: number` – cap turns in this stage.
- `timeoutMs?: number` – time-based escape hatch.
- `onEnter?(ctx)` / `onExit?(ctx)` – stage lifecycle hooks.
- `metadata?: Record<string, unknown>` – arbitrary extra data.

Example:
```ts
const greetingStage: Stage = {
  id: 'greeting',
  name: 'Greeting',
  systemPrompt: 'Welcome the user and briefly ask how you can help.',
  maxTurns: 3,
  twoPhaseExecution: true
};
```

## Transition

A **transition** describes when and how to move between stages.

Key fields (see `Transition` type):
- `id: string` – unique id.
- `from: string | '*'` – source stage or `'*'` for any.
- `condition: TransitionCondition` – when to fire.
- `action: { targetStage, transitionMessage?, clearHistory?, data? }`.
- `priority?: number` – higher evaluated first when multiple match.

`TransitionCondition` variants:
- `{ type: 'tool_call', toolName }`
- `{ type: 'intent', intent, confidence? }`
- `{ type: 'keyword', keywords: string[] }`
- `{ type: 'llm_decision' }` – driven by the built-in `playbook_transition` tool.
- `{ type: 'max_turns', count }`
- `{ type: 'timeout', durationMs }`
- `{ type: 'custom', evaluate: (ctx) => boolean | Promise<boolean> }`

Example:
```ts
const toAuth: Transition = {
  id: 'greeting_to_auth',
  from: 'greeting',
  condition: { type: 'keyword', keywords: ['order', 'refund', 'account'] },
  action: { targetStage: 'authentication' }
};
```

## Playbook

The **playbook** ties stages and transitions together.

Key fields (see `Playbook` type):
- `id`, `name`, `description?`, `version?`.
- `stages: Stage[]` – all stages.
- `transitions: Transition[]` – all transitions.
- `initialStage: string` – id of starting stage.
- `globalTools?: ToolDefinition[]` – tools available everywhere.
- `globalSystemPrompt?: string` – prefix added to every stage prompt.
- `defaultLLMConfig?: StageLLMConfig` – defaults for all stages.
- `metadata?: Record<string, unknown>`.

Example skeleton:
```ts
import type { Playbook, Stage, Transition } from '@metered/llmrtc-core';

const stages: Stage[] = [greetingStage, authStage, triageStage, resolutionStage, farewellStage];
const transitions: Transition[] = [toAuth, authToTriage, triageToResolution, resolutionToFarewell];

export const supportPlaybook: Playbook = {
  id: 'support',
  name: 'Customer Support Assistant',
  description: 'Guides users through auth, triage, and resolution.',
  stages,
  transitions,
  initialStage: 'greeting',
  globalSystemPrompt: 'You are a concise, polite support agent.',
  defaultLLMConfig: { temperature: 0.5, maxTokens: 512 }
};
```

## Validation

Use `validatePlaybook(playbook)` to catch common mistakes at startup:
- Missing `initialStage`.
- Duplicate stage or transition IDs.
- Transitions that reference unknown stages.

```ts
import { validatePlaybook } from '@metered/llmrtc-core';

const { valid, errors } = validatePlaybook(supportPlaybook);
if (!valid) {
  throw new Error('Invalid playbook: ' + errors.join('; '));
}
```

Next: [Text agents with PlaybookOrchestrator](text-agents).
