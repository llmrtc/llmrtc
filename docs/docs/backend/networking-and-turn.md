---
title: Networking & TURN
---

Reliable WebRTC needs ICE servers. You can use Metered TURN, your own TURN, or both.

## Metered TURN (built-in helper)
Set env vars (CLI mode) or `metered` option (library mode):

```bash
METERED_APP_NAME=your-app
METERED_API_KEY=your-key
METERED_REGION=us_east   # optional
```

```ts
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  metered: { appName: 'your-app', apiKey: 'your-key', region: 'us_east' }
});
```

Server fetches TURN creds and sends them to clients in the `ready` message.

## Custom ICE servers

Env (CLI):
```bash
ICE_SERVERS='[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
```

Library:
```ts
const server = new LLMRTCServer({
  providers: { llm, stt, tts },
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }
  ]
});
```

Client override (optional):
```ts
const client = new LLMRTCWebClient({ signallingUrl, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
```

## Priority order
1) Explicit `iceServers` passed to client
2) `iceServers` passed to backend constructor
3) Metered TURN config (if provided)
4) Default STUN `stun:stun.metered.ca:80`

## Tips
- Provide TURN for users behind strict NAT/firewalls; test with mobile + corporate networks.
- Keep signalling (WS) and TURN geographically close to users.
- Allow UDP 3478/5349; fall back to TCP/TLS if needed.
