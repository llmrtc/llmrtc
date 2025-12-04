---
title: Security
---

**API keys**
- Store provider keys (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, etc.) in environment variables or a secrets manager.
- The backend (`LLMRTCServer`) reads them via `createProvidersFromEnv` (see `packages/backend/src/providers.ts`).
- Never expose these keys to the browser or logs.

**CORS & network boundaries**
- Use the `cors` option on `LLMRTCServer` to restrict browser origins allowed to call your backend.
- Put the backend behind an API gateway / reverse proxy that handles TLS, auth, and IP-based rate limiting.

**Auth**
- The bundled server does not implement authentication itself; recommended patterns:
  - Terminate TLS and authenticate at a gateway (e.g., API gateway, NGINX with JWT validation) and only forward to LLMRTC for authorized users.
  - In library mode, host LLMRTC inside your own Express app and ensure only authenticated routes can reach the signalling endpoint or WebSocket upgrade.
- Use `sessionId` from the `ready` message and hooks (`onConnection`, `onDisconnect`) to correlate sessions with your own user/account IDs.

**Rate limiting & quotas**
- Apply rate limiting at the proxy or gateway per API key / user / IP.
- Limit concurrent sessions per account on your side using hook data and metrics (`llmrtc.sessions.active`, `llmrtc.connections.active`).

**Data retention**
- Transcripts and attachments may contain PII; decide where and how long to store them.
- Use hooks (`onSTTEnd`, `onLLMEnd`) to stream transcripts into your own datastore with explicit retention policies.

**TLS**
- Always use HTTPS/WSS in production to protect audio, transcripts, and any tokens you send over the signalling channel.
- Deploy `LLMRTCServer` behind a TLS-terminating proxy (NGINX, Caddy, API gateway) rather than terminating TLS inside the Node process.
