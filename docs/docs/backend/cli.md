---
title: CLI Mode
---

CLI mode lets you run the LLMRTC backend directly from the command line with environment variable configuration. This is the fastest way to get started.

---

## Quick Start

```bash
# Install the package
npm install @llmrtc/llmrtc-backend

# Set required environment variables
export OPENAI_API_KEY=sk-...

# Start the server
npx llmrtc-backend
```

The server starts on `http://127.0.0.1:8787` by default.

---

## Environment Variables

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | HTTP/WebSocket port |
| `HOST` | `127.0.0.1` | Bind address |
| `SYSTEM_PROMPT` | (built-in) | System prompt for the assistant |
| `HISTORY_LIMIT` | `8` | Max messages in conversation history |
| `STREAMING_TTS` | `true` | Enable streaming TTS |

### Provider Selection

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | Force LLM provider: `openai`, `anthropic`, `gemini`, `bedrock`, `openrouter`, `ollama`, `lmstudio` |
| `STT_PROVIDER` | Force STT provider: `openai`, `whisper`, `faster-whisper` |
| `TTS_PROVIDER` | Force TTS provider: `openai`, `elevenlabs`, `piper` |

If not specified, providers are auto-detected based on available API keys.

### API Keys

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI (LLM, STT, TTS) |
| `ANTHROPIC_API_KEY` | Anthropic (LLM) |
| `GOOGLE_API_KEY` | Google Gemini (LLM) |
| `ELEVENLABS_API_KEY` | ElevenLabs (TTS) |
| `OPENROUTER_API_KEY` | OpenRouter (LLM) |

### TURN Configuration

| Variable | Description |
|----------|-------------|
| `METERED_APP_NAME` | Metered.ca app name for TURN |
| `METERED_API_KEY` | Metered.ca API key for TURN |
| `METERED_REGION` | Preferred TURN region |

### Local Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_ONLY` | `false` | Use only local providers |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Ollama model name |
| `LMSTUDIO_BASE_URL` | `http://localhost:1234/v1` | LM Studio server URL |
| `LMSTUDIO_MODEL` | (auto) | LM Studio model name |
| `FASTER_WHISPER_URL` | `http://localhost:9000` | Faster-Whisper server URL |
| `PIPER_URL` | `http://localhost:5002` | Piper TTS server URL |

---

## Example Configurations

### OpenAI Stack

```bash
export OPENAI_API_KEY=sk-...
export SYSTEM_PROMPT="You are a helpful voice assistant."
npx llmrtc-backend
```

### Mixed Providers

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export ELEVENLABS_API_KEY=xi-...
export LLM_PROVIDER=anthropic
export TTS_PROVIDER=elevenlabs
npx llmrtc-backend
```

### Local-Only Stack

```bash
export LOCAL_ONLY=true
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3
export FASTER_WHISPER_URL=http://localhost:9000
export PIPER_URL=http://localhost:5002
npx llmrtc-backend
```

---

## Using .env Files

Create a `.env` file in your working directory:

```bash
# .env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=xi-...
SYSTEM_PROMPT=You are a helpful assistant.
PORT=8787
STREAMING_TTS=true
```

Load it before starting:

```bash
# Using dotenv
node -r dotenv/config node_modules/.bin/llmrtc-backend

# Or with shell
source .env && npx llmrtc-backend
```

---

## Health Check

The server exposes a health endpoint:

```bash
curl http://localhost:8787/health
# {"ok":true}
```

Use this for load balancer health checks and monitoring.

---

## Logging

Logs are written to stdout. In production, redirect to a log file or log aggregator:

```bash
npx llmrtc-backend 2>&1 | tee server.log
```

Log levels and formats can be customized in library mode.

---

## Process Management

For production deployments, use a process manager:

### PM2

```bash
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'llmrtc',
    script: 'npx',
    args: 'llmrtc-backend',
    env: {
      OPENAI_API_KEY: 'sk-...',
      PORT: 8787
    }
  }]
};

# Start
pm2 start ecosystem.config.js
```

### systemd

```ini
# /etc/systemd/system/llmrtc.service
[Unit]
Description=LLMRTC Backend
After=network.target

[Service]
Type=simple
User=llmrtc
WorkingDirectory=/opt/llmrtc
EnvironmentFile=/opt/llmrtc/.env
ExecStart=/usr/bin/npx llmrtc-backend
Restart=always

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim

# Install FFmpeg for streaming TTS
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install @llmrtc/llmrtc-backend

EXPOSE 8787
CMD ["npx", "llmrtc-backend"]
```

---

## Related Documentation

- [Library Mode](library) - Programmatic usage for more control
- [Configuration](configuration) - All configuration options
- [Environment Variables](environment-variables) - Complete variable reference
- [Deployment](deployment) - Production deployment guide
