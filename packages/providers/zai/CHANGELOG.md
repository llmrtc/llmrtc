# @llmrtc/llmrtc-provider-zai

## 1.2.0

### Minor Changes

- 246b6f6: New model ecosystems: Z.ai GLM and current local vision models.
  - New @llmrtc/llmrtc-provider-zai package: ZaiLLMProvider for Z.ai's GLM
    family (default glm-5.2 - 1M context, open weights, strong tool calling)
    via the OpenAI-compatible API, with full tool-calling and streaming
    support. CLI: LLM_PROVIDER=zai with ZAI_API_KEY/ZAI_MODEL.
  - Local vision generalized: OllamaVisionProvider works with any
    vision-capable Ollama model and defaults to qwen3-vl;
    LlavaVisionProvider remains as a compatible alias defaulting to llava.
    CLI: OLLAMA_VISION_MODEL selects the model (the CLI default stays
    llava, so existing LOCAL_ONLY deployments are unaffected - set
    OLLAMA_VISION_MODEL=qwen3-vl to opt in). The CLI vision provider now
    also honors OLLAMA_BASE_URL. Qwen 3.6 multimodal runs through LM
    Studio vision attachments (Ollama GGUF support pending upstream).

### Patch Changes

- Updated dependencies [fd91344]
- Updated dependencies [319bb47]
- Updated dependencies [a7d1ecc]
  - @llmrtc/llmrtc-core@1.2.0
