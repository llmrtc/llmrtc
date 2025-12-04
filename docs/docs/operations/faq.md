---
title: FAQ
---

**Do I need FFmpeg?**
Only if `streamingTTS` is enabled. Non-streaming TTS works without it.

**Can I disable WebRTC audio and just use websockets?**
Yes. Send `audio` messages (base64 WAV) as a fallback, but latency will be higher.

**How do I persist transcripts?**
Listen to transcript events and write them to your datastore. The server does not persist by default.

**Does the client work on mobile browsers?**
Yes on modern iOS/Android browsers that support WebRTC + mic permissions; test TURN for cellular networks.

**Can I swap providers per message?**
Yes—either change env vars at startup or select providers dynamically in library mode.
