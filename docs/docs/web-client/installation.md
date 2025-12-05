---
title: Installation
---

Guide for installing and setting up the LLMRTC web client in your frontend application.

---

## Package Installation

```bash
npm install @metered/llmrtc-web-client
```

Or with other package managers:

```bash
# Yarn
yarn add @metered/llmrtc-web-client

# pnpm
pnpm add @metered/llmrtc-web-client
```

---

## Module Format

The package ships as ESM (ECMAScript Modules) and works in modern browsers and build tools:

```typescript
// ESM import
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';
```

---

## Framework Setup

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  // No special configuration needed
});
```

```typescript
// src/client.ts
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: import.meta.env.VITE_SIGNAL_URL
});
```

Environment variables:

```bash
# .env
VITE_SIGNAL_URL=wss://your-server.com
```

### Next.js

For Next.js, guard browser-only APIs in components:

```typescript
// components/VoiceClient.tsx
'use client';

import { useEffect, useState } from 'react';
import type { LLMRTCWebClient as ClientType } from '@metered/llmrtc-web-client';

export function VoiceClient() {
  const [client, setClient] = useState<ClientType | null>(null);

  useEffect(() => {
    // Dynamic import to avoid SSR issues
    import('@metered/llmrtc-web-client').then(({ LLMRTCWebClient }) => {
      const instance = new LLMRTCWebClient({
        signallingUrl: process.env.NEXT_PUBLIC_SIGNAL_URL!
      });
      setClient(instance);
    });

    return () => {
      client?.close();
    };
  }, []);

  return <div>{/* UI */}</div>;
}
```

Environment variables:

```bash
# .env.local
NEXT_PUBLIC_SIGNAL_URL=wss://your-server.com
```

### Create React App

```typescript
// src/client.ts
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: process.env.REACT_APP_SIGNAL_URL!
});
```

Environment variables:

```bash
# .env
REACT_APP_SIGNAL_URL=wss://your-server.com
```

### Vue 3

```typescript
// src/composables/useVoiceClient.ts
import { ref, onMounted, onUnmounted } from 'vue';
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

export function useVoiceClient() {
  const client = ref<LLMRTCWebClient | null>(null);
  const state = ref('disconnected');

  onMounted(() => {
    client.value = new LLMRTCWebClient({
      signallingUrl: import.meta.env.VITE_SIGNAL_URL
    });

    client.value.on('stateChange', (s) => {
      state.value = s;
    });
  });

  onUnmounted(() => {
    client.value?.close();
  });

  return { client, state };
}
```

### Svelte

```svelte
<!-- VoiceClient.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

  let client: LLMRTCWebClient;
  let state = 'disconnected';

  onMount(() => {
    client = new LLMRTCWebClient({
      signallingUrl: import.meta.env.VITE_SIGNAL_URL
    });

    client.on('stateChange', (s) => {
      state = s;
    });
  });

  onDestroy(() => {
    client?.close();
  });
</script>

<div>State: {state}</div>
```

---

## TypeScript Support

The package includes TypeScript definitions. Import types as needed:

```typescript
import {
  LLMRTCWebClient,
  type ConnectionState,
  type ClientError,
  type LLMRTCWebClientConfig
} from '@metered/llmrtc-web-client';

const config: LLMRTCWebClientConfig = {
  signallingUrl: 'wss://your-server.com',
  reconnection: {
    enabled: true,
    maxRetries: 5
  }
};

const client = new LLMRTCWebClient(config);

client.on('stateChange', (state: ConnectionState) => {
  console.log(state);
});

client.on('error', (error: ClientError) => {
  console.error(error);
});
```

---

## CDN Usage

For simple prototypes, use a CDN:

```html
<script type="module">
  import { LLMRTCWebClient } from 'https://esm.sh/@metered/llmrtc-web-client';

  const client = new LLMRTCWebClient({
    signallingUrl: 'wss://your-server.com'
  });

  await client.start();
</script>
```

---

## Peer Dependencies

The package has no peer dependencies. All WebRTC and WebSocket functionality uses browser-native APIs.

Required browser APIs:
- `WebSocket`
- `RTCPeerConnection`
- `navigator.mediaDevices.getUserMedia`
- `MediaStream`

---

## Development Setup

For local development with the backend:

```bash
# Terminal 1: Start backend
cd backend
npm run dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

Configure the client to connect to localhost:

```typescript
const client = new LLMRTCWebClient({
  signallingUrl: 'ws://localhost:8787'  // Note: ws:// not wss:// for local
});
```

---

## SSL in Development

For HTTPS development (required for getUserMedia in some browsers):

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Use with Vite
# vite.config.ts
import fs from 'fs';

export default defineConfig({
  server: {
    https: {
      key: fs.readFileSync('./key.pem'),
      cert: fs.readFileSync('./cert.pem')
    }
  }
});
```

---

## Verification

Verify installation works:

```typescript
import { LLMRTCWebClient } from '@metered/llmrtc-web-client';

const client = new LLMRTCWebClient({
  signallingUrl: 'wss://your-server.com'
});

client.on('stateChange', (state) => {
  console.log('State:', state);
});

client.on('error', (error) => {
  console.error('Error:', error);
});

try {
  await client.start();
  console.log('Connected successfully!');
} catch (error) {
  console.error('Connection failed:', error);
}
```

---

## Related Documentation

- [Overview](overview) - Client capabilities
- [Connection Lifecycle](connection-lifecycle) - State management
- [Audio](audio) - Microphone setup
- [Events](events) - Event handling
