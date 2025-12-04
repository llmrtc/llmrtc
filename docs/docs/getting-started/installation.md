---
title: Installation
---

Install the backend (Node server) and the web client (browser SDK). Each can be used independently.

```bash
# Backend with all providers re-exported
npm install @metered/llmrtc-backend

# Web client for browser apps
npm install @metered/llmrtc-web-client

# Core types only (advanced)
npm install @metered/llmrtc-core
```

**Requirements**
- Node.js 20+
- For streaming TTS: FFmpeg installed and on PATH
- Web client: modern browser with WebRTC + microphone permissions

**Monorepo note**
If you cloned this repo, run installs from the root using npm workspaces:
```bash
npm install
```
