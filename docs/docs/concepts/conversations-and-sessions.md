---
title: Conversations & Sessions
---

LLMRTC tracks sessions to keep history, reconnect users, and coordinate WebRTC + websocket messaging.

Key ideas
- **Session ID**: assigned on `ready` message; used to reconnect after network blips.
- **History limit**: `historyLimit` controls how many prior messages are kept in context.
- **Reconnection**: client calls `reconnect` with the last sessionId; server responds with `reconnect-ack` and optionally restores history.
- **Persistence**: you can store transcripts server-side; hook into server events for custom storage.

Best practices
- Display current connection state to users (connecting, connected, reconnecting, failed).
- On reconnect, replay only minimal UI state; audio/video tracks are re-established automatically.
- Tune `historyLimit` to balance context quality vs. token costs.

Grounding in code
- `SessionManager` (`packages/backend/src/session-manager.ts`) tracks session state and supports reconnection.
- The `ready` message (see Protocol → Message Types) includes `id` (sessionId) and `protocolVersion`.
- Reconnect flow: client sends `reconnect` with `sessionId`, server replies with `reconnect-ack { success, historyRecovered }`.

See also:
- Web Client → Connection Lifecycle
- Protocol → Connection Lifecycle
- Backend → Observability & Hooks (for `onConnection` / `onDisconnect` hooks)
