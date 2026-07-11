---
title: Local - Vision Models
---

Local multimodal vision via any vision-capable model — **Qwen3-VL**
(recommended), **Gemma 3**, **LLaVA**, or **Llama 3.2 Vision** — served by
Ollama or LM Studio. No cloud API, no per-image cost.

## Which model, which runtime?

| Model | Runtime | Notes |
|-------|---------|-------|
| `qwen3-vl` | Ollama | Current-generation local vision; the `OllamaVisionProvider` default |
| `gemma3` | Ollama | Strong general multimodal, small footprint options |
| `llava` / `llava:13b` | Ollama | The classic; still fine for basic description |
| Qwen 3.6 (27B / 35B-A3B) | **LM Studio** | Vision is native in the base model, but its GGUFs don't load in Ollama yet (mmproj support pending) — run through LM Studio and use `LMStudioLLMProvider` vision attachments |

There are **two ways** to do local vision in LLMRTC:

1. **Vision attachments on the LLM (recommended)** — use `OllamaLLMProvider`
   or `LMStudioLLMProvider` with a vision-capable model; camera/screen frames
   captured by the web client flow into the conversation automatically. The
   Ollama provider probes the model's capabilities and raises a clear error
   if the selected model can't see images.
2. **A dedicated `VisionProvider`** — `OllamaVisionProvider` answers
   standalone describe-this-image requests outside the conversation flow.

:::tip
`OllamaVisionProvider` defaults to `qwen3-vl`. The older `LlavaVisionProvider`
name still works (it defaults to `llava`), but new code should use
`OllamaVisionProvider`.
:::

## Official Documentation

- [LLaVA Project Page](https://llava-vl.github.io/)
- [LLaVA GitHub](https://github.com/haotian-liu/LLaVA)
- [Ollama LLaVA Model](https://ollama.com/library/llava)
- [Ollama Vision Models Blog](https://ollama.com/blog/vision-models)
- [Ollama Vision Model Search](https://ollama.com/search?c=vision)

---

## Local Setup (via Ollama)

Vision models run locally through Ollama, which handles model downloading and
serving.

### 1. Install Ollama

See [Local - Ollama](local-ollama) for installation instructions, or:

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Start Ollama Server

```bash
ollama serve
```

### 3. Pull a Vision Model

```bash
# Recommended: current-generation Qwen3-VL (the provider default)
ollama pull qwen3-vl

# Alternatives
ollama pull gemma3
ollama pull llava
ollama pull llama3.2-vision
```

### 4. Verify

```bash
# Test with an image
ollama run qwen3-vl "Describe this image: /path/to/image.jpg"

# Check API
curl http://localhost:11434/api/tags
```

---

## Provider Configuration

### Default Local Setup

```ts
import { OllamaVisionProvider } from '@llmrtc/llmrtc-provider-local';

// Defaults: qwen3-vl on http://localhost:11434
const vision = new OllamaVisionProvider();
```

### Pinning a Specific Model

```ts
const vision = new OllamaVisionProvider({
  model: 'gemma3'
});
```

### Custom Server URL

```ts
const vision = new OllamaVisionProvider({
  baseUrl: 'http://my-vision-host:11434',
  model: 'qwen3-vl'
});
```

### Configuration Options

```ts
interface OllamaVisionConfig {
  baseUrl?: string;  // Defaults to http://localhost:11434
  model?: string;    // Defaults to 'qwen3-vl'
}
```

### Environment Variables (CLI mode)

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL (shared with the LLM provider) |
| `OLLAMA_VISION_MODEL` | `llava` | Vision model used by the CLI backend. The CLI default stays `llava` so existing `LOCAL_ONLY` deployments keep working — set it to `qwen3-vl` to use the current generation |

---

## Available Vision Models

| Model | Size | Features | Use Case |
|-------|------|----------|----------|
| `qwen3-vl` | 4B-235B variants | Current generation, strong OCR and document/chart understanding | Recommended default |
| `gemma3` | 4B / 12B / 27B | Strong general multimodal, small footprint options | Resource-constrained setups |
| `llama3.2-vision` | 11B / 90B | Meta's vision model | OCR, object detection |
| `llava` | 7B / 13B / 34B | The classic; lightest to run | Basic description |
| `llava-llama3` | 8B | LLaVA on a Llama 3 base | Improved language |

---

## Usage Examples

### JavaScript/TypeScript

```ts
import Ollama from 'ollama';

const response = await Ollama.chat({
  model: 'qwen3-vl',
  messages: [{
    role: 'user',
    content: 'What do you see in this image?',
    images: ['./photo.jpg']  // or base64 encoded
  }]
});

console.log(response.message.content);
```

### REST API

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen3-vl",
  "prompt": "Describe what you see",
  "images": ["<base64-encoded-image>"]
}'
```

---

## Notes

- Requires Ollama with a vision-capable model
- Keep frame rate low when sending video frames to avoid CPU/GPU spikes
- First request may be slow while model loads into memory
- 8GB+ RAM recommended; 16GB+ for larger models
- GPU acceleration significantly improves performance
- Images are automatically resized by Ollama before processing
