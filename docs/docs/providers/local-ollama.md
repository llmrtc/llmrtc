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
  model: 'llama3.2',
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | - | Default model to use |

### Provider Options

```ts
interface OllamaConfig {
  baseUrl?: string;   // Server URL
  model: string;      // Model name (e.g., 'llama3.2')
  options?: {
    num_ctx?: number;      // Context window size (default: 4096)
    num_predict?: number;  // Max tokens to generate
    temperature?: number;  // Sampling temperature (0-1)
    num_thread?: number;   // CPU threads to use
  };
}
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

## Notes

- Pull the model first before running: `ollama pull <model>`
- Good for offline/edge deployments
- Expect higher latency on CPU-only machines
- GPU acceleration with NVIDIA is automatic when drivers are installed
- Minimum 8GB RAM recommended; 16GB+ for larger models
