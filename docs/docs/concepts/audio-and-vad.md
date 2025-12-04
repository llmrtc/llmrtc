---
title: Audio, VAD & Barge-in
---

Voice UX depends on tight audio handling.

- **WebRTC audio track**: primary path for microphone audio to backend.
- **VAD (Silero)**: detects speech start/end server-side; emits `speech-start` / `speech-end` and drives barge-in.
- **Barge-in**: when the user starts speaking during TTS, the server cancels TTS and restarts the turn.
- **Fallback audio message**: `audio` message (base64 WAV) exists for environments without WebRTC audio tracks.

Recommendations
- Surface listening/thinking/speaking states in UI.
- Keep input sample rates consistent (48 kHz recommended) to minimize resampling artifacts.
- If you stream TTS, ensure FFmpeg is installed; otherwise use non-streaming TTS.

See also:
- Web Client → Audio Capture & Playback
- Backend → Observability & Hooks (for `onSpeechStart` / `onSpeechEnd` hooks)
