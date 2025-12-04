---
title: Local - LLaVA
---

Local vision via LLaVA.

Setup
```ts
import { LlavaVisionProvider } from '@metered/llmrtc-provider-local';

const vision = new LlavaVisionProvider({
  model: 'llava:7b'
});
```

Notes
- Requires a compatible LLaVA deployment (e.g., via Ollama or local server).
- Keep frame rate low when sending images to local models to avoid CPU/GPU spikes.
