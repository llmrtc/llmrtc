---
title: Troubleshooting
---

Common issues
- **No audio / mic blocked**: ensure `getUserMedia` permission; served over HTTPS/localhost.
- **WebRTC fails to connect**: add TURN servers; check firewall for UDP; verify signalling URL.
- **High latency**: enable streaming TTS; move backend closer; pick faster models (`gpt-4o-mini`, `gemini-flash`).
- **TTS silence**: FFmpeg missing when `streamingTTS=true`; fall back to non-streaming or install FFmpeg.
- **Tool call errors**: validate JSON Schema; log arguments; ensure tools return serializable results.
- **Session drops**: check heartbeat timeout; handle reconnect on the client.

Debug tips
- Open browser devtools → Network → WS to inspect messages.
- Enable verbose logging on backend hooks for a single session.

See also:
- Backend → Networking & TURN (for ICE/TURN issues)
- Backend → Observability & Hooks (for logging and metrics)
- Operations → Logging & Metrics
