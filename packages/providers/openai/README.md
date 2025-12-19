# @llmrtc/llmrtc-provider-openai

OpenAI LLM, STT (Whisper), and TTS providers for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-openai
```

## Providers

### LLM

```typescript
import { OpenAILLMProvider } from '@llmrtc/llmrtc-provider-openai';

const llm = new OpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o'
});
```

### STT (Whisper)

```typescript
import { OpenAIWhisperProvider } from '@llmrtc/llmrtc-provider-openai';

const stt = new OpenAIWhisperProvider({
  apiKey: process.env.OPENAI_API_KEY!
});
```

### TTS

```typescript
import { OpenAITTSProvider } from '@llmrtc/llmrtc-provider-openai';

const tts = new OpenAITTSProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  voice: 'alloy'
});
```

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
