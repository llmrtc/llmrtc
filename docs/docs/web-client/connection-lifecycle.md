---
title: Connection Lifecycle
---

States
- `disconnected` → `connecting` → `connected`
- `reconnecting` when recovering a session
- `failed` on fatal errors; `closed` after manual `close()`

Key methods
- `start()` – opens WebSocket, negotiates WebRTC data channel
- `close()` – shuts down
- `reconnect()` – automatic; emitted via `stateChange`

Events
- `ready` (implicit) → `stateChange`
- `reconnecting` (attempt, maxAttempts)
- `stateChange` (state)

Tips
- Show a banner during reconnects; queue user input until `connected`.
- Persist `sessionId` in localStorage to rejoin after page refresh.
