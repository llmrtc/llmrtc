---
title: UI Patterns
---

Make state visible:
- Listening ↔ Thinking ↔ Speaking indicators
- Live transcript area (final + partial)
- Response stream that appends `llmChunk`
- Waveform or level meter for mic input

Playback controls:
- Tap to mute/unmute mic
- Stop button that triggers `close()` or stops current TTS
- Reconnect banner with retry

Accessibility:
- Keyboard shortcuts to start/stop mic
- Captions for TTS playback
- High-contrast indicators for connection state
