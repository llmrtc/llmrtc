---
title: Local - Piper
---

Local text-to-speech via [Piper](https://github.com/rhasspy/piper), a fast neural TTS system optimized for local execution.

## Official Documentation

- [Piper GitHub](https://github.com/rhasspy/piper)
- [Wyoming-Piper GitHub](https://github.com/rhasspy/wyoming-piper)
- [Voice Samples](https://rhasspy.github.io/piper-samples/)
- [Voice Models on Hugging Face](https://huggingface.co/rhasspy/piper-voices)
- [PyPI - piper-tts](https://pypi.org/project/piper-tts/)

---

## Local Setup

### Using Docker (Recommended)

**Wyoming-Piper Server:**
```bash
docker run -d \
  --name piper \
  -p 10200:10200 \
  -v /path/to/voices:/data \
  rhasspy/wyoming-piper \
  --voice en_US-lessac-medium
```

**With HTTP Server (for REST API):**
```bash
# Using piper-http-server
pip install piper-http-server
piper-http-server --port 5002 --model en_US-amy-medium.onnx
```

### Manual Installation

**1. Download Piper binary:**
```bash
# Linux x86_64
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
cd piper
```

**2. Download a voice model:**
```bash
# Download voice model and config
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

**3. Run HTTP server:**
```bash
pip install piper-http-server
piper-http-server --port 5002 --model en_US-amy-medium.onnx
```

### Using pip (Python)

```bash
pip install piper-tts

# Test from command line
echo "Hello world" | piper --model en_US-amy-medium.onnx --output_file test.wav
```

### Verify

```bash
# Test TTS endpoint
curl -X POST http://localhost:5002/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}' \
  --output test.wav

# Play the audio
ffplay test.wav  # or: aplay test.wav
```

---

## Provider Configuration

```ts
import { PiperTTSProvider } from '@metered/llmrtc-provider-local';

const tts = new PiperTTSProvider({
  baseUrl: process.env.PIPER_URL || 'http://localhost:5002'
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPER_URL` | `http://localhost:5002` | Piper server URL |

### Provider Options

```ts
interface PiperConfig {
  baseUrl?: string;   // Server URL
  voice?: string;     // Voice model name
}
```

---

## Available Voices

| Voice | Language | Quality | Size |
|-------|----------|---------|------|
| `en_US-amy-medium` | English (US) | Good | 60MB |
| `en_US-lessac-medium` | English (US) | Good | 60MB |
| `en_US-ryan-medium` | English (US) | Good | 60MB |
| `en_GB-cori-medium` | English (UK) | Good | 60MB |
| `de_DE-thorsten-medium` | German | Good | 60MB |
| `es_ES-mls_9972-medium` | Spanish | Good | 60MB |
| `fr_FR-siwis-medium` | French | Good | 60MB |

Browse all 30+ languages at [rhasspy.github.io/piper-samples](https://rhasspy.github.io/piper-samples/).

---

## Key Features

- **Fast Inference**: Optimized for real-time use, even on Raspberry Pi
- **ONNX Models**: Uses efficient ONNX-based VITS voice models
- **Multi-language**: 30+ languages supported
- **Small Footprint**: Voice models are typically 60-100MB
- **No Internet Required**: Fully offline operation

---

## Notes

- Choose a fast Piper voice (medium quality) for real-time use
- Works well with streaming TTS enabled in the server
- Both `.onnx` model and `.json` config files are required
- Python package supports 3.7-3.10
- For lowest latency, run on a machine with good single-thread CPU performance
