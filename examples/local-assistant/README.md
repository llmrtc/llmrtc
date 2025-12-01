# Local Assistant Example

A 100% local/private voice assistant using Ollama, Faster-Whisper, and Piper with sandboxed file tools.

## Features

- **Fully local** - No cloud APIs, all processing on your machine
- **Privacy-focused** - Your data never leaves your computer
- **File tools** - Read files, list directories, search content
- **Sandboxed** - Tools restricted to safe directories only

## Prerequisites

1. **Ollama** - Local LLM runtime
   ```bash
   # Install Ollama: https://ollama.ai
   ollama pull llama3.2
   ollama serve
   ```

2. **Docker** - For Faster-Whisper and Piper
   ```bash
   npm run docker:up
   ```

## Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (restricted to allowed directories) |
| `list_directory` | List files in a directory |
| `search_files` | Search for text patterns in files |
| `run_command` | Run safe, whitelisted commands |

## Security

Tools are sandboxed for safety:

- **Allowed directories**: `~/Documents`, `~/Downloads` (configurable)
- **Whitelisted commands**: `ls`, `cat`, `wc`, `date`, `echo`, `pwd`, `head`, `tail`
- **No write operations**: All tools are read-only

## Setup

1. Install and start Ollama:
   ```bash
   ollama pull llama3.2
   ollama serve
   ```

2. Start Docker services:
   ```bash
   npm run docker:up
   ```

3. Copy environment file:
   ```bash
   cp .env.example .env
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Start the development server:
   ```bash
   npm run dev
   ```

6. Open http://localhost:5173 in your browser

## Try It

Say things like:
- "List my documents folder"
- "Read the readme file in downloads"
- "Search for 'TODO' in my documents"
- "What files are in my downloads?"
- "What's today's date?"

## Docker Compose

The `docker-compose.yml` sets up:
- **Faster-Whisper**: Local speech-to-text (port 8000)
- **Piper**: Local text-to-speech (port 5000)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Machine                            │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Ollama    │  │  Faster-    │  │    Piper    │         │
│  │  (LLM)      │  │  Whisper    │  │   (TTS)     │         │
│  │             │  │   (STT)     │  │             │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│                    ┌─────┴─────┐                            │
│                    │  server   │                            │
│                    │  .ts      │◄─── Sandboxed Tools        │
│                    └─────┬─────┘     (file/cmd access)      │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │ WebRTC + WebSocket
                           ▼
                    ┌─────────────┐
                    │   Browser   │
                    │   Client    │
                    └─────────────┘
```

## Configuring Allowed Directories

Edit `.env` to change allowed directories:

```bash
# Allow access to specific folders
ALLOWED_DIRECTORIES=~/Projects,~/Notes,/tmp
```

## Model Selection

You can use any Ollama model. Recommended models:

| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `llama3.2` | 3B | Fast | Good |
| `llama3.1` | 8B | Medium | Better |
| `mistral` | 7B | Medium | Good |
| `phi3` | 3.8B | Fast | Good |

Change model in `.env`:
```bash
OLLAMA_MODEL=mistral
```
