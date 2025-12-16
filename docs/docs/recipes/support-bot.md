---
title: Support Bot
---

Based on [`examples/support-bot`](https://github.com/llmrtc/llmrtc/tree/main/examples/support-bot).

What it does
- Uses documents or FAQs as context
- Streams responses with empathy tone
- Includes tool calls for ticket creation (example tool)

Run
```bash
npm install
npm run dev
```

Adaptations
- Replace the tool implementation to create real tickets in your system.
- Add prompt guardrails for compliance language.
