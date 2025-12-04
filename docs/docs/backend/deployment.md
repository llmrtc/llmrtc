---
title: Deployment
---

Guidelines for running the backend in production.

**Process manager**
- Use systemd/pm2/Docker to restart on failure and manage environment variables.
- Ensure `PORT`, `HOST`, provider keys, and TURN config are set via env (see Backend → Environment Variables).

**HTTPS/WSS & reverse proxy**
- Terminate TLS at a reverse proxy (NGINX, Caddy, API gateway) and proxy WebSocket traffic to the backend port.
- Configure the proxy with WebSocket upgrade headers (`Upgrade`, `Connection`) and timeouts appropriate for long-lived connections.

**ICE/TURN**
- Configure TURN using Metered (Backend → Networking & TURN) or your own `iceServers`.
- Test connectivity on real networks; fall back to TURN when STUN-only connectivity fails.

**Scaling**
- Use sticky sessions for WebSocket connections so reconnections hit the same backend node when possible.
- Scale horizontally by running multiple `LLMRTCServer` instances behind a load balancer.
- Keep an eye on CPU/network usage and provider limits; scale based on concurrency and model usage.

**Health checks**
- `/health` returns `{ ok: true }` when the server is up.
- Optionally add custom endpoints via `server.getApp()` to check provider reachability or external dependencies.

**Docker considerations**
- Expose port `8787` (or your chosen `PORT`).
- Include FFmpeg in the image when using streaming TTS.
- Increase `/dev/shm` size if you see WebRTC-related shared memory issues.

Cross-links
- Backend → Networking & TURN
- Backend → Security
- Operations → Scaling & Performance
