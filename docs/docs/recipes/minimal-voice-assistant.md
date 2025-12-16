---
title: Minimal Voice Assistant
---

Based on [`examples/minimal`](https://github.com/llmrtc/llmrtc/tree/main/examples/minimal) (~80 LOC backend + frontend).

What it shows
- Streaming STT, LLM, and TTS
- UI states for listening/thinking/speaking
- WebRTC audio playback

Run
```bash
npm install
npm run dev        # starts Vite frontend + backend
# Frontend: http://localhost:5173
# Backend:  http://localhost:8787/health
```

Keys
- `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`

Use this as a template for new projects.
