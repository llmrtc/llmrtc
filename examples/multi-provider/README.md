# Multi-Provider LLMRTC Example

Demonstrates how to configure and switch between different LLM, STT, and TTS providers.

## What This Demonstrates

- **Provider Factory Pattern**: Clean abstraction for provider instantiation
- **Runtime Configuration**: Select providers via environment variables
- **Provider Availability**: Shows which providers are configured
- **API Endpoints**: REST endpoints for provider information

## Available Providers

### LLM (Language Model)

| Provider | Key | API Key Required |
|----------|-----|------------------|
| OpenAI GPT-4o | `openai` | `OPENAI_API_KEY` |
| Anthropic Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| Google Gemini | `gemini` | `GOOGLE_API_KEY` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` |
| AWS Bedrock | `bedrock` | `AWS_ACCESS_KEY_ID` |
| LM Studio | `lmstudio` | None (local) |
| Ollama | `ollama` | None (local) |

### STT (Speech-to-Text)

| Provider | Key | API Key Required |
|----------|-----|------------------|
| OpenAI Whisper | `openai` | `OPENAI_API_KEY` |
| Faster-Whisper | `faster-whisper` | None (local) |

### TTS (Text-to-Speech)

| Provider | Key | API Key Required |
|----------|-----|------------------|
| ElevenLabs | `elevenlabs` | `ELEVENLABS_API_KEY` |
| OpenAI TTS | `openai` | `OPENAI_API_KEY` |
| Piper | `piper` | None (local) |

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure providers:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and provider selection
   ```

3. **Select providers** (in .env):
   ```bash
   LLM_PROVIDER=openai
   STT_PROVIDER=openai
   TTS_PROVIDER=elevenlabs
   ```

4. **Run the example:**
   ```bash
   npm run dev
   ```

5. **Open browser:**
   - Frontend: http://localhost:5173
   - API: http://localhost:8787/api/providers

## API Endpoints

### GET /api/providers

Lists all available providers and their status:

```json
{
  "llm": [
    { "key": "openai", "name": "OpenAI GPT-4o", "available": true },
    { "key": "anthropic", "name": "Anthropic Claude", "available": false },
    ...
  ],
  "stt": [...],
  "tts": [...]
}
```

### GET /api/providers/current

Returns currently selected providers:

```json
{
  "llm": "openai",
  "stt": "openai",
  "tts": "elevenlabs"
}
```

## Code Highlights

### Provider Factory Pattern (server.ts)

```typescript
const llmProviders: Record<string, ProviderFactory<LLMProvider>> = {
  openai: {
    name: 'OpenAI GPT-4o',
    available: !!process.env.OPENAI_API_KEY,
    create: () => new OpenAILLMProvider({
      apiKey: process.env.OPENAI_API_KEY!,
      model: 'gpt-4o-mini'
    })
  },
  anthropic: {
    name: 'Anthropic Claude',
    available: !!process.env.ANTHROPIC_API_KEY,
    create: () => new AnthropicLLMProvider({
      apiKey: process.env.ANTHROPIC_API_KEY!
    })
  },
  // ... more providers
};
```

### Using Selected Providers

```typescript
const server = new LLMRTCServer({
  providers: {
    llm: llmProviders[process.env.LLM_PROVIDER || 'openai'].create(),
    stt: sttProviders[process.env.STT_PROVIDER || 'openai'].create(),
    tts: ttsProviders[process.env.TTS_PROVIDER || 'elevenlabs'].create()
  }
});
```

## Switching Providers

To switch providers, update your `.env` file and restart the server:

```bash
# Switch from OpenAI to Anthropic
LLM_PROVIDER=anthropic

# Switch to local TTS
TTS_PROVIDER=piper
```

Note: Changing providers requires server restart. Runtime switching would require implementing a reconnection mechanism.

## Provider Comparison

| Provider | Latency | Quality | Cost |
|----------|---------|---------|------|
| OpenAI GPT-4o | Medium | Excellent | $$$ |
| Anthropic Claude | Medium | Excellent | $$$ |
| Google Gemini | Fast | Very Good | $$ |
| Ollama (local) | Varies | Good | Free |

| STT Provider | Latency | Accuracy |
|--------------|---------|----------|
| OpenAI Whisper | Fast | Excellent |
| Faster-Whisper | Medium | Very Good |

| TTS Provider | Latency | Quality |
|--------------|---------|---------|
| ElevenLabs | Fast | Excellent |
| OpenAI TTS | Medium | Very Good |
| Piper | Fast | Good |
