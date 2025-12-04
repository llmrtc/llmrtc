---
title: Video, Screen & Vision
---

- `shareVideo(cameraStream, fps?)` sends camera frames at the given FPS (default 1 fps recommended).
- `shareScreen(screenStream, fps?)` sends screen captures similarly.
- Frames are batched and attached to the next speech segment; the server forwards them to the vision-capable LLM provider.

Recommendations
- Keep FPS low (0.5–2) to reduce bandwidth.
- Offer a toggle for users to pause sharing.
- Include `alt` text for attachments when possible.

Cross-links
- Concepts → Vision & Attachments (for `VisionAttachment` semantics)
- Providers → OpenAI / Anthropic / Google Gemini / Local LLaVA for vision-capable models
