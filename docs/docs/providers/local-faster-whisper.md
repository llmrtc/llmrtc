---
title: Local - Faster-Whisper
---

Local speech-to-text via [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper), a fast reimplementation of OpenAI's Whisper using CTranslate2.

## Official Documentation

- [Faster-Whisper GitHub](https://github.com/SYSTRAN/faster-whisper)
- [faster-whisper-server GitHub](https://github.com/fedirz/faster-whisper-server)
- [Docker Hub - fedirz/faster-whisper-server](https://hub.docker.com/r/fedirz/faster-whisper-server)
- [PyPI - faster-whisper](https://pypi.org/project/faster-whisper/)

---

## Local Setup

### Using Docker (Recommended)

**CPU-only:**
```bash
docker run -d \
  --name faster-whisper \
  -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  fedirz/faster-whisper-server:latest-cpu
```

**With GPU (NVIDIA):**
```bash
docker run -d \
  --gpus all \
  --name faster-whisper \
  -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  fedirz/faster-whisper-server:latest-cuda
```

**Using Docker Compose:**
```bash
curl -sO https://raw.githubusercontent.com/fedirz/faster-whisper-server/master/compose.yaml

# For GPU
docker compose up --detach faster-whisper-server-cuda

# For CPU
docker compose up --detach faster-whisper-server-cpu
```

### Using pip

```bash
pip install faster-whisper-server
faster-whisper-server --host 0.0.0.0 --port 8000
```

### Verify

```bash
curl http://localhost:8000/health
# Should return: {"status":"ok"}
```

---

## Provider Configuration

```ts
import { FasterWhisperProvider } from '@metered/llmrtc-provider-local';

const stt = new FasterWhisperProvider({
  baseUrl: process.env.FASTER_WHISPER_URL || 'http://localhost:8000'
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FASTER_WHISPER_URL` | `http://localhost:8000` | Faster-Whisper server URL |

### Provider Options

```ts
interface FasterWhisperConfig {
  baseUrl?: string;   // Server URL
  model?: string;     // Model size: 'tiny', 'base', 'small', 'medium', 'large-v3'
  language?: string;  // Force language (e.g., 'en') for faster processing
}
```

---

## Model Comparison

| Model | Size | Speed | Accuracy | VRAM |
|-------|------|-------|----------|------|
| `tiny` | 75MB | Fastest | Basic | ~1GB |
| `base` | 145MB | Fast | Good | ~1GB |
| `small` | 500MB | Medium | Better | ~2GB |
| `medium` | 1.5GB | Slower | Great | ~5GB |
| `large-v3` | 3GB | Slowest | Best | ~10GB |

---

## Key Features

- **OpenAI API Compatible**: Drop-in replacement for OpenAI Whisper API
- **Streaming Support**: Transcription sent via SSE as audio is processed
- **Dynamic Model Loading**: Specify model per request; auto-loads and offloads
- **Live Transcription**: Audio sent via WebSocket for real-time transcription

---

## Notes

- Lower latency than cloud STT when running on GPU locally
- Ensure the server runs with a compatible model
- Test with a short WAV file before integrating
- For GPU support, ensure NVIDIA Container Toolkit is installed
- Models are cached in `~/.cache/huggingface` by default
