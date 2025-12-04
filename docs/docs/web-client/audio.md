---
title: Audio Capture & Playback
---

Capture
- Use `shareAudio(stream)` with `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Returns a controller with `stop()`; call it when leaving the page.

Playback
- TTS arrives as a WebRTC `MediaStreamTrack` (`ttsTrack` event) or as chunks if streaming is disabled.
- Attach the track to an `Audio` element and play immediately for low latency.

Tips
- Request mic permission only after user interaction (click).
- Display levels/recording indicator to build trust.
- On barge-in, handle `ttsCancelled` to stop current audio.

Cross-links
- Concepts → Audio, VAD & Barge-in
- Web Client → Events (for `speechStart`, `speechEnd`, `ttsCancelled`)
