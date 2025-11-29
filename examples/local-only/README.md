# Local-Only LLMRTC Example

Run a voice AI assistant entirely on your local machine - no cloud API keys required!

## What This Demonstrates

- **100% Local AI**: Ollama (LLM) + Faster-Whisper (STT) + Piper (TTS)
- **Privacy**: Your voice and conversations never leave your machine
- **Offline**: Works without internet connection (after initial setup)

## Prerequisites

### 1. Install Ollama

```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2
```

### 2. Start Local Services

Using Docker Compose (recommended):

```bash
# Start Faster-Whisper and Piper
npm run docker:up

# Or manually with docker-compose
docker-compose up -d
```

Or manually:

```bash
# Faster-Whisper (Speech-to-Text)
docker run -d -p 8000:8000 fedirz/faster-whisper-server:latest-cpu

# Piper (Text-to-Speech)
docker run -d -p 5000:10200 rhasspy/wyoming-piper --voice en_US-lessac-medium
```

### 3. Start Ollama

```bash
ollama serve
```

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start local services** (see Prerequisites above)

3. **Run the example:**
   ```bash
   npm run dev
   ```

4. **Open browser:**
   - Frontend: http://localhost:5173
   - Backend: http://localhost:8787/health

## Service Health Check

The server checks all services on startup:

```
  Local-Only LLMRTC Server
  ========================
  Running entirely on your local machine!

  Checking local services...
    Ollama (http://localhost:11434): OK
    Faster-Whisper (http://localhost:8000): OK
    Piper (http://localhost:5000): OK

  All services running!
```

## Troubleshooting

### "Ollama NOT RUNNING"
```bash
ollama serve
```

### "Faster-Whisper NOT RUNNING"
```bash
docker-compose up faster-whisper
# or
docker run -d -p 8000:8000 fedirz/faster-whisper-server:latest-cpu
```

### "Piper NOT RUNNING"
```bash
docker-compose up piper
# or
docker run -d -p 5000:10200 rhasspy/wyoming-piper --voice en_US-lessac-medium
```

### Model not found
```bash
ollama pull llama3.2
```

## Performance Notes

- **First request**: May be slow as models load into memory
- **Subsequent requests**: Much faster once models are warm
- **Memory**: Ollama + Whisper + Piper need ~4-8GB RAM
- **GPU**: If you have a GPU, use GPU-enabled Docker images for faster inference

## Local Service Alternatives

| Service | Alternative Options |
|---------|---------------------|
| LLM | Ollama (any model), LM Studio |
| STT | Faster-Whisper, local Whisper |
| TTS | Piper, Coqui TTS |

## Privacy

All processing happens locally:
- Your voice is transcribed locally by Faster-Whisper
- Your text is processed locally by Ollama
- The response is spoken locally by Piper
- No data is sent to any cloud service
