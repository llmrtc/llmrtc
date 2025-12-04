---
title: Conversation Orchestrator
---

Handles turn-by-turn coordination between providers.

Example (streaming):
```ts
const orchestrator = new ConversationOrchestrator({
  systemPrompt: 'You are a helpful assistant.',
  historyLimit: 8,
  providers: { llm, stt, tts, vision }
});

for await (const item of orchestrator.runTurnStream(audioBuffer)) {
  if ('isFinal' in item) console.log('Transcript:', item.text);
  if ('done' in item) console.log('LLM chunk:', item.content);
  if ('audio' in item) console.log('TTS bytes:', item.audio.length);
}
```

Features
- Maintains chat history
- Streams intermediate results
- Supports tool calling via `tools` / `toolChoice`
- Accepts vision attachments per turn

Use orchestrator directly when you want full control outside the bundled server.
