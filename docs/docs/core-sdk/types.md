---
title: Core Types
---

Key interfaces (simplified):

```ts
interface LLMProvider {
  name: string;
  init?(): Promise<void>;
  complete(request: LLMRequest): Promise<LLMResult>;
  stream?(request: LLMRequest): AsyncIterable<LLMChunk>;
}

interface STTProvider {
  name: string;
  transcribe(audio: Buffer, config?: STTConfig): Promise<STTResult>;
  transcribeStream?(audio: AsyncIterable<Buffer>, config?: STTConfig): AsyncIterable<STTResult>;
}

interface TTSProvider {
  name: string;
  speak(text: string, config?: TTSConfig): Promise<TTSResult>;
  speakStream?(text: string, config?: TTSConfig): AsyncIterable<Buffer>;
}
```

Messages follow the protocol types (`ClientMessage`, `ServerMessage`, etc.) exported from the core package.

Use these definitions to type your custom providers and tooling.
