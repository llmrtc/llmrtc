# @llmrtc/llmrtc-provider-local

Local model providers for LLMRTC - Ollama, Faster-Whisper, Piper TTS.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-local
```

## Providers

### Ollama (LLM)

```typescript
import { OllamaLLMProvider } from '@llmrtc/llmrtc-provider-local';

const llm = new OllamaLLMProvider({
  baseUrl: 'http://localhost:11434',
  model: 'llama3.2'
});
```

### Faster-Whisper (STT)

```typescript
import { FasterWhisperProvider } from '@llmrtc/llmrtc-provider-local';

const stt = new FasterWhisperProvider({
  baseUrl: 'http://localhost:9000'
});
```

### Piper (TTS)

```typescript
import { PiperTTSProvider } from '@llmrtc/llmrtc-provider-local';

const tts = new PiperTTSProvider({
  baseUrl: 'http://localhost:5002'
});
```

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
