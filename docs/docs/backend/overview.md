---
title: Backend Overview
---

`@metered/llmrtc-backend` is a Node.js server that bundles signaling, WebRTC data/audio handling, provider selection, and orchestration.

Capabilities
- WebSocket + WebRTC signaling
- Automatic provider selection based on env vars
- VAD, barge-in, reconnection, session management
- Health endpoint (`/health`) and events for observability

Use it two ways
- **CLI mode**: `npx llmrtc-backend` with env vars
- **Library mode**: create an `LLMRTCServer` inside your own Node app

Related: [CLI](cli) · [Library](library) · [Configuration](configuration) · [Env Vars](environment-variables).
