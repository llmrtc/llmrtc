---
title: Testing & Mocking
---

This section outlines patterns for testing providers, orchestrators, and clients grounded in the actual interfaces in `@metered/llmrtc-core`.

## Providers

- Implement tests around `LLMProvider`, `STTProvider`, `TTSProvider`, and `VisionProvider` (see `packages/core/src/types.ts`).
- Stub external HTTP clients and assert on normalized results (`LLMResult`, `STTResult`, `TTSResult`, `VisionResult`).
- Verify that errors and stop reasons (`stopReason`) are mapped correctly from provider-specific errors.

Example (LLM provider):
```ts
const llm = new MyLLMProvider({ apiKey: 'test', client: fakeClient });
const result = await llm.complete({ messages: [{ role: 'user', content: 'hi' }] });
expect(result.fullText).toContain('hello');
```

## Orchestrator

- For `ConversationOrchestrator` and `PlaybookOrchestrator`, pass fake providers that return deterministic values.
- Use `InMemoryMetrics` from `@metered/llmrtc-core` to assert that metrics (`MetricNames.*`) are emitted.
- Use hooks (see Core SDK → Hooks & Metrics) to observe turn timings, errors, and tool usage.

```ts
import { ConversationOrchestrator, InMemoryMetrics } from '@metered/llmrtc-core';

const metrics = new InMemoryMetrics();
const orchestrator = new ConversationOrchestrator({ providers: fakeProviders, metrics });

const audio = Buffer.from('...');
for await (const item of orchestrator.runTurnStream(audio)) {
  // collect STT/LLM/TTS events
}

expect(metrics.timings.some(t => t.name === MetricNames.STT_DURATION)).toBe(true);
```

## Playbooks

- Use `validatePlaybook` to test that your playbook definitions are structurally sound.
- For `PlaybookOrchestrator`, unit-test `executeTurn` and `streamTurn` with canned input and no real network calls.
- Assert on `TurnResult` (response, toolCalls, transitions) and stage changes.

## Frontend (web client)

- In React apps, mock `LLMRTCWebClient` and emit events (`transcript`, `llmChunk`, `ttsTrack`, `toolCallStart`, `stageChange`) to validate UI state changes.
- For end-to-end tests, use the Playwright configuration in `e2e/playwright.config.ts` with fake media devices.

## In this repo

- Vitest is configured at the root (`npm test`, `npm run test:unit`).
- End-to-end tests live under `e2e/` (see Meta → Testing & E2E and `e2e/README.md`).
- Example observability tests use `InMemoryMetrics` and logging hooks.
