---
title: Vision & Attachments
---

Send images alongside audio to enable multimodal prompts.

- **Attachments message**: client can queue `attachments` (base64 data URI or URL) to be delivered with the next speech segment.
- **Video/screen sharing**: `shareVideo` / `shareScreen` capture frames at a chosen FPS; frames are attached automatically after `speech-end`.
- **Vision providers**: OpenAI, Anthropic, Gemini, and LLaVA (local) support image input.

Tips
- Keep frame rate low (0.5–2 FPS) to control bandwidth and cost.
- Use `alt` text in attachments for accessibility and better grounding.
- For screen capture, prompt the model to describe the UI region of interest.

See also:
- Web Client → Video, Screen & Vision
- Providers → OpenAI / Anthropic / Google Gemini / Local LLaVA for vision support
