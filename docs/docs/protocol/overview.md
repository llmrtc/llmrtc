---
title: Protocol Overview
---

Wire protocol v1 defines JSON messages over WebSocket and WebRTC data channel between the web client and backend.

- **Version**: `PROTOCOL_VERSION = 1`
- **Channels**: signaling over WebSocket; payload over WebRTC data channel (fallback to WebSocket).
- **Handshake**: client connects → server sends `ready` with sessionId + protocolVersion.

The client should warn or fail if protocol versions mismatch.
