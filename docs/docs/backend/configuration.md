---
title: Server Configuration
---

`LLMRTCServer` options (selected):

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `providers` | `{ llm, stt, tts, vision? }` | required | Provider instances or factory funcs |
| `port` | `number` | `8787` | TCP port |
| `host` | `string` | `127.0.0.1` | Bind address |
| `systemPrompt` | `string` | `'You are a helpful...'` | Prepended to conversation |
| `historyLimit` | `number` | `8` | Messages kept in context |
| `streamingTTS` | `boolean` | `true` | Needs FFmpeg |
| `heartbeatTimeout` | `number` | `45000` | ms before disconnect |
| `cors` | `CorsOptions` | `undefined` | CORS config |

Other notable knobs
- `playbook`, `toolRegistry`, and `playbookOptions` for voice playbook mode
- `metrics` / `hooks` for observability (see Observability)
- `sentenceChunker` to customize how streaming TTS is split into sentences (e.g., handle non-Latin punctuation)

Set via constructor in code or through environment variables (see next page).
