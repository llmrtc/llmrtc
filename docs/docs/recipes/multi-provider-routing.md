---
title: Multi-provider Routing
---

Based on [`examples/multi-provider`](https://github.com/llmrtc/llmrtc/tree/main/examples/multi-provider).

Idea
- Route requests to different LLMs based on task (cost/latency/quality).
- Example: use `gpt-5.1-mini` for chit-chat, `claude-sonnet-4-5` for tool use, `gemini` for vision.

Approach
- Instantiate multiple providers and select per turn using your own logic.
- Expose a `provider` field in requests from the client, or infer from message content.

Run
```bash
npm install
npm run dev
```

Ensure all required API keys are set for the providers you route to.
