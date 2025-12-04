---
title: Installation (Web Client)
---

```bash
npm install @metered/llmrtc-web-client
```

If you are in this monorepo, the package is already present; import directly in your frontend workspace.

The client ships as ESM and works in modern browsers. For Node-based SSR (Next.js), guard browser-only APIs (`navigator`, `window`).

Typical setup (Vite):
- Add `VITE_SIGNAL_URL` env var pointing to your backend WebSocket URL (see `e2e/playwright.config.ts` for example usage).
- In your app, pass that URL into `LLMRTCWebClient`:
  ```ts
  const client = new LLMRTCWebClient({ signallingUrl: import.meta.env.VITE_SIGNAL_URL });
  ```

See also: Web Client → Connection Lifecycle.
