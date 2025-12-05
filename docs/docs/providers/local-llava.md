---
title: Local - LLaVA
---

Local vision capabilities via [LLaVA](https://llava-vl.github.io/) (Large Language and Vision Assistant), a multimodal model that combines vision and language understanding.

:::tip Alternative: Native Vision with OllamaLLMProvider
For simpler setups, you can use `OllamaLLMProvider` with a vision-capable model like **Gemma3** or **LLaVA**. The provider automatically detects vision support and handles attachments natively - no separate vision provider needed. See [Local Ollama - Multimodal Support](local-ollama#multimodalvision-support).
:::

## Official Documentation

- [LLaVA Project Page](https://llava-vl.github.io/)
- [LLaVA GitHub](https://github.com/haotian-liu/LLaVA)
- [Ollama LLaVA Model](https://ollama.com/library/llava)
- [Ollama Vision Models Blog](https://ollama.com/blog/vision-models)
- [Ollama Vision Model Search](https://ollama.com/search?c=vision)

---

## Local Setup (via Ollama)

LLaVA runs locally through Ollama, which handles model downloading and serving.

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

### 3. Pull LLaVA Model

```bash
# Standard LLaVA (7B parameters)
ollama pull llava

# LLaVA 1.6 with higher resolution support
ollama pull llava:13b

# LLaVA based on Llama 3
ollama pull llava-llama3
```

### 4. Verify

```bash
# Test with an image
ollama run llava "Describe this image: /path/to/image.jpg"

# Check API
curl http://localhost:11434/api/tags
```

---

## Provider Configuration

### Default Local Setup

```ts
import { LlavaVisionProvider } from '@metered/llmrtc-provider-local';

const vision = new LlavaVisionProvider({
  model: 'llava'
});
```

This assumes Ollama is running on `http://localhost:11434`.

### Custom Server URL

```ts
const vision = new LlavaVisionProvider({
  baseUrl: 'http://my-llava-host:11434',
  model: 'llava:13b'
});
```

### Configuration Options

```ts
interface LlavaConfig {
  baseUrl?: string;  // Defaults to http://localhost:11434
  model?: string;    // Defaults to 'llava'
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |

---

## Available Vision Models

| Model | Size | Features | Use Case |
|-------|------|----------|----------|
| `llava` | 7B | Good balance | General vision tasks |
| `llava:13b` | 13B | Better accuracy | Complex scene analysis |
| `llava:34b` | 34B | Highest quality | Detailed reasoning |
| `llava-llama3` | 8B | Latest Llama base | Improved language |
| `llama3.2-vision` | 11B | Meta's vision model | OCR, object detection |
| `llama3.2-vision:90b` | 90B | Largest Meta vision | Advanced reasoning |

---

## LLaVA 1.6 Features

The latest LLaVA 1.6 version includes:

- **Higher Resolution**: Supports up to 4x more pixels
- **Better Text Recognition**: Improved OCR capabilities
- **Enhanced Reasoning**: Better at charts, diagrams, and documents
- **Permissive Licenses**: Apache 2.0 or LLaMA 2 Community License

---

## Usage Examples

### JavaScript/TypeScript

```ts
import Ollama from 'ollama';

const response = await Ollama.chat({
  model: 'llava',
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
  "model": "llava",
  "prompt": "Describe what you see",
  "images": ["<base64-encoded-image>"]
}'
```

---

## Notes

- Requires Ollama with a LLaVA-compatible model
- Keep frame rate low when sending video frames to avoid CPU/GPU spikes
- First request may be slow while model loads into memory
- 8GB+ RAM recommended; 16GB+ for larger models
- GPU acceleration significantly improves performance
- Images are automatically resized by Ollama before processing
