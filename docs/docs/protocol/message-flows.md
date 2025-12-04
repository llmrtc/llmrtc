---
title: Message Flows
---

Voice turn (happy path)
```
speech-start → speech-end → transcript (final) → llm-chunk* → llm → tts-start → tts-chunk* → tts-complete
```
`*` streamed when enabled.

Barge-in
```
tts-start → user speaks → speech-start → tts-cancelled → transcript → llm-chunk ...
```

Reconnect
```
WebSocket reconnect → ready → reconnect { sessionId } → reconnect-ack { success }
```

Playbook mode
```
llm-chunk → tool-call-start → tool-call-end → stage-change → llm-chunk → tts-start
```
