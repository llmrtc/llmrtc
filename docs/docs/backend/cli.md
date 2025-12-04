---
title: CLI Mode
---

Run the bundled server directly with environment variables.

```bash
# Install once
npm install @metered/llmrtc-backend

# Configure
cat <<'ENV' > .env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=xi-...
PORT=8787
ENV

# Start
npx llmrtc-backend
```

Health: `GET /health` returns `{ status: 'ok' }` when running.

Flags via env vars:
- `LLM_PROVIDER`, `TTS_PROVIDER`, `STT_PROVIDER` to force providers
- `SYSTEM_PROMPT`, `HISTORY_LIMIT`, `STREAMING_TTS`, `PORT`, `HOST`
- Local stack: `LOCAL_ONLY=true` and corresponding URLs

Logs are printed to stdout; use a process manager (pm2/systemd) for production.
