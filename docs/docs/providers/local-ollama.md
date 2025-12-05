---
title: Local - Ollama
---

Run LLMs locally via [Ollama](https://ollama.com).

## Official Documentation

- [Ollama GitHub](https://github.com/ollama/ollama)
- [Ollama Downloads](https://ollama.com/download)
- [Model Library](https://ollama.com/library)

---

## Local Setup

### Installation

**macOS:**
```bash
brew install ollama
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
Download from [ollama.com/download](https://ollama.com/download/windows)

**Docker:**
```bash
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama

# With GPU support (NVIDIA)
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
```

### Start the Server

```bash
ollama serve
```

### Pull a Model

```bash
# Recommended for voice (fast, good quality)
ollama pull llama3.2

# Alternative: smaller model for low-resource machines
ollama pull phi3

# Alternative: larger model for better quality
ollama pull llama3.1:8b
```

### Verify

```bash
# Test the model
ollama run llama3.2 "Hello, how are you?"

# Check API
curl http://localhost:11434/api/tags
```

---

## Provider Configuration

```ts
import { OllamaLLMProvider } from '@metered/llmrtc-provider-local';

const llm = new OllamaLLMProvider({
  model: 'llama3.2'
});
```

### Configuration Options

```ts
interface OllamaConfig {
  model?: string;     // Model name (default: 'llama3.1')
  baseUrl?: string;   // Server URL (default: 'http://localhost:11434')
}
```

### Custom Server URL

```ts
const llm = new OllamaLLMProvider({
  model: 'llama3.2',
  baseUrl: 'http://192.168.1.100:11434'
});
```

---

## Recommended Models

| Model | Size | Use Case |
|-------|------|----------|
| `llama3.2` | 3B | Fast, good for voice |
| `llama3.2:1b` | 1B | Very fast, basic tasks |
| `llama3.1:8b` | 8B | Higher quality |
| `phi3` | 3.8B | Good balance |
| `mistral` | 7B | Strong reasoning |

---

## Multimodal/Vision Support

OllamaLLMProvider automatically detects vision-capable models and supports image attachments. When you send images to a non-vision model, the provider throws a clear error.

### Supported Vision Models

| Model | Size | Features |
|-------|------|----------|
| `gemma3` | 4B, 12B, 27B | Google's latest multimodal |
| `llava` | 7B, 13B, 34B | General vision tasks |
| `llama3.2-vision` | 11B, 90B | Meta's vision model |

### Pull a Vision Model

```bash
# Gemma 3 (recommended for vision)
ollama pull gemma3

# LLaVA
ollama pull llava

# Llama 3.2 Vision
ollama pull llama3.2-vision
```

### Usage Example

```ts
import { OllamaLLMProvider } from '@metered/llmrtc-provider-local';

const llm = new OllamaLLMProvider({
  model: 'gemma3'  // or 'llava', 'llama3.2-vision'
});

const result = await llm.complete({
  messages: [{
    role: 'user',
    content: 'What do you see in this image?',
    attachments: [{ data: 'data:image/png;base64,...' }]
  }]
});

console.log(result.fullText);
```

### How It Works

1. On first request, the provider calls Ollama's `/api/show` endpoint to check model capabilities
2. If the model supports vision and the message has attachments, images are included in the request
3. If the model does NOT support vision and attachments are present, an error is thrown
4. Capability results are cached per provider instance

---

## Notes

- Pull the model first before running: `ollama pull <model>`
- Good for offline/edge deployments
- Expect higher latency on CPU-only machines
- GPU acceleration with NVIDIA is automatic when drivers are installed
- Minimum 8GB RAM recommended; 16GB+ for larger models
