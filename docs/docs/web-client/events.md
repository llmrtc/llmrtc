---
title: Client Events
---

Common events
- `transcript(text, isFinal?)`
- `llm(fullText)` and `llmChunk(chunk)`
- `tts(audio, format)` and `ttsTrack(mediaStream)`
- `ttsStart`, `ttsComplete`, `ttsCancelled`
- `speechStart`, `speechEnd`
- `stateChange(state)`, `reconnecting(attempt, maxAttempts)`
- `error(error)`
- `toolCallStart({ name, callId, arguments })`
- `toolCallEnd({ callId, result, error, durationMs })`
- `stageChange({ from, to, reason })` (playbook mode)

Usage
```ts
client.on('transcript', (text) => setTranscript(text));
client.on('llmChunk', (chunk) => setResponse((r) => r + chunk));
client.on('ttsTrack', (stream) => {
  audio.srcObject = stream;
  audio.play();
});
client.on('toolCallStart', ({ name }) => setTools((t) => [...t, { name, status: 'running' }]));
client.on('toolCallEnd', ({ callId, result, error }) => updateTool(callId, { result, error, status: 'done' }));
client.on('stageChange', ({ to }) => setStage(to));
client.on('stateChange', setConnectionState);
```

Handle errors gracefully and prompt the user to retry or check microphone permissions.
