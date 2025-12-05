---
title: Providers Overview
---

LLMRTC supports multiple LLM/STT/TTS/Vision providers with a consistent API (see `packages/backend/src/providers.ts`). Mix and match as needed.

Selection strategies
- **Auto-detect** via env vars (default)
- **Pin** a provider per environment (e.g., OpenAI in prod, local in dev)
- **Route dynamically** per request in library mode (custom logic selecting different providers).

Capabilities (high level)

| Provider            | Type    | Streaming | Vision | Tools | Local/Cloud |
|---------------------|---------|----------:|--------|-------|-------------|
| OpenAI              | LLM/STT/TTS | ✅ | ✅ (via attachments) | ✅ | Cloud |
| Anthropic Claude    | LLM     | ✅ | ✅ (via attachments) | ✅ | Cloud |
| Google Gemini       | LLM     | ✅ | ✅ (multimodal)       | ✅ | Cloud |
| AWS Bedrock         | LLM     | ✅*| model-dependent      | ✅ | Cloud |
| OpenRouter          | LLM     | ✅ | model-dependent      | ✅ | Cloud |
| LMStudio            | LLM     | ✅*| model-dependent      | ✅ | Local |
| Ollama              | LLM     | ✅*| ✅ (Gemma3, LLaVA, etc.) | ✅ | Local |
| Faster-Whisper      | STT     | ✅*| –                    | –  | Local |
| Piper               | TTS     | ✅*| –                    | –  | Local |
| LLaVA               | Vision  | –  | ✅                   | –  | Local |

`*` Streaming support depends on the specific model/server; see individual provider pages for details.

See also:
- OpenAI, Anthropic, Gemini, Bedrock, OpenRouter, LMStudio pages under **Providers**.
- Local provider pages (Ollama, Faster-Whisper, Piper, LLaVA) for offline stacks.
- Backend → Environment Variables for provider selection and auto-detection.
