# @llmrtc/llmrtc-provider-elevenlabs

ElevenLabs TTS provider for LLMRTC.

## Installation

```bash
npm install @llmrtc/llmrtc-provider-elevenlabs
```

## Usage

```typescript
import { ElevenLabsTTSProvider } from '@llmrtc/llmrtc-provider-elevenlabs';

const tts = new ElevenLabsTTSProvider({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: 'EXAVITQu4vr4xnSDxMaL' // Sarah
});
```

## Features

- High-quality voice synthesis
- Multiple voice options
- Streaming audio support
- Configurable voice settings

## Documentation

Full documentation: [https://www.llmrtc.org](https://www.llmrtc.org)

## License

Apache-2.0
