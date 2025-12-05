---
title: Troubleshooting
---

This guide covers common issues, error codes, and debugging techniques for LLMRTC applications.

---

## Error Codes Reference

When errors occur, the server sends structured error messages with these codes:

### Connection Errors

| Code | Description | Common Causes |
|------|-------------|---------------|
| `WEBRTC_UNAVAILABLE` | WebRTC not supported or blocked | Browser incompatibility, HTTPS required |
| `CONNECTION_FAILED` | Connection establishment failed | Network issues, firewall blocking UDP |
| `SESSION_NOT_FOUND` | Session ID not recognized | Reconnecting to expired session |
| `SESSION_EXPIRED` | Session timed out | Inactivity beyond TTL (default 30 min) |

### Provider Errors

| Code | Description | Common Causes |
|------|-------------|---------------|
| `STT_ERROR` | Speech-to-text failed | Invalid audio, provider API error |
| `STT_TIMEOUT` | STT processing exceeded timeout | Audio too long, slow provider |
| `LLM_ERROR` | LLM inference failed | Invalid prompt, API key issues |
| `LLM_TIMEOUT` | LLM response exceeded timeout | Complex query, provider overload |
| `TTS_ERROR` | Text-to-speech synthesis failed | Invalid text, provider API error |
| `TTS_TIMEOUT` | TTS exceeded timeout | Long text, slow provider |

### Processing Errors

| Code | Description | Common Causes |
|------|-------------|---------------|
| `AUDIO_PROCESSING_ERROR` | Audio processing failed | Corrupted audio, format mismatch |
| `VAD_ERROR` | Voice activity detection failed | Invalid audio format |
| `INVALID_MESSAGE` | Malformed protocol message | Client/server version mismatch |
| `INVALID_AUDIO_FORMAT` | Unsupported audio format | Wrong sample rate, encoding |

### Playbook/Tool Errors

| Code | Description | Common Causes |
|------|-------------|---------------|
| `TOOL_ERROR` | Tool execution failed | Tool threw exception, invalid arguments |
| `PLAYBOOK_ERROR` | Playbook orchestration failed | Invalid stage, missing handler |

### Generic Errors

| Code | Description | Common Causes |
|------|-------------|---------------|
| `INTERNAL_ERROR` | Unexpected server error | Bug, resource exhaustion |
| `RATE_LIMITED` | Too many requests | Provider rate limit hit |

---

## Common Issues

### No Audio / Microphone Blocked

**Symptoms:**
- Browser console shows `NotAllowedError: Permission denied`
- No `speechStart` events triggered
- Microphone icon not appearing in browser

**Solutions:**
1. Ensure the page is served over HTTPS or localhost
2. Check browser permission settings for the site
3. Verify `getUserMedia` is called correctly:
   ```typescript
   const stream = await navigator.mediaDevices.getUserMedia({
     audio: {
       echoCancellation: true,
       noiseSuppression: true
     }
   });
   ```

---

### WebRTC Connection Fails

**Symptoms:**
- Client stuck in `connecting` state
- Browser console shows ICE connection failed
- Works on localhost but not in production

**Log excerpt:**
```
ICE connection state: failed
ICE gathering state: complete
No valid ICE candidates found
```

**Solutions:**
1. **Add TURN servers** - Required for users behind symmetric NAT:
   ```typescript
   const server = new LLMRTCServer({
     metered: {
       appName: 'your-app',
       apiKey: process.env.METERED_API_KEY!
     }
   });
   ```

2. **Check firewall rules** - Allow UDP on ports 3478, 5349, and 49152-65535

3. **Verify signalling URL** matches the server:
   ```typescript
   // Client
   const client = new LLMRTCWebClient({
     signallingUrl: 'wss://your-server.com'  // Use wss:// for production
   });
   ```

4. **Test with STUN only** to isolate issues:
   ```typescript
   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
   ```

---

### High Latency

**Symptoms:**
- Long delay between speaking and response
- Turn-around time > 2 seconds

**Diagnosis checklist:**
```typescript
// Add timing hooks to identify bottleneck
hooks: {
  onSTTEnd: (ctx, result, timing) => {
    console.log(`STT: ${timing.durationMs}ms`);
  },
  onLLMEnd: (ctx, result, timing) => {
    console.log(`LLM: ${timing.durationMs}ms, TTFT: ${timing.ttftMs}ms`);
  },
  onTTSEnd: (ctx, timing) => {
    console.log(`TTS: ${timing.durationMs}ms`);
  }
}
```

**Solutions by component:**

| Component | Solution |
|-----------|----------|
| STT slow | Use `whisper-1` model, ensure audio is short |
| LLM slow (high TTFT) | Use `gpt-4o-mini` or `gemini-flash`; reduce system prompt |
| LLM slow (streaming) | Enable streaming (default) |
| TTS slow | Enable `streamingTTS: true`; use shorter responses |
| Network | Deploy backend closer to users; use edge regions |

---

### TTS Produces Silence

**Symptoms:**
- `ttsComplete` event fires but no audio plays
- Works in development but not production

**Log excerpt:**
```
Error: FFmpeg not found
TTS streaming disabled, falling back to non-streaming
```

**Solutions:**
1. **Install FFmpeg** (required for streaming TTS):
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   apt-get install ffmpeg

   # Docker
   RUN apt-get update && apt-get install -y ffmpeg
   ```

2. **Disable streaming TTS** if FFmpeg unavailable:
   ```typescript
   const server = new LLMRTCServer({
     streamingTTS: false  // Uses non-streaming fallback
   });
   ```

3. **Check audio element** - Client must connect ttsTrack to audio element:
   ```typescript
   client.on('ttsTrack', (stream) => {
     const audio = new Audio();
     audio.srcObject = stream;
     audio.play().catch(err => console.error('Playback failed:', err));
   });
   ```

---

### Tool Call Errors

**Symptoms:**
- `TOOL_ERROR` returned to client
- LLM response incomplete after tool call

**Log excerpt:**
```
Tool execution failed: get_weather
Error: Cannot read properties of undefined (reading 'temperature')
Arguments: {"city":"New York"}
```

**Solutions:**
1. **Validate JSON Schema** matches expected arguments:
   ```typescript
   defineTool({
     name: 'get_weather',
     description: 'Get current weather',
     parameters: z.object({
       city: z.string().describe('City name'),
       units: z.enum(['celsius', 'fahrenheit']).optional()
     }),
     execute: async ({ city, units = 'celsius' }) => {
       // Handle optional parameters with defaults
     }
   });
   ```

2. **Add error handling** in tool implementation:
   ```typescript
   execute: async (args) => {
     try {
       const data = await fetchWeather(args.city);
       return { temperature: data.temp, condition: data.condition };
     } catch (error) {
       // Return error object instead of throwing
       return { error: 'Weather service unavailable' };
     }
   }
   ```

3. **Ensure serializable results** - No functions, circular references:
   ```typescript
   // Bad: Contains non-serializable data
   return { data: rawResponse, fetch: () => {} };

   // Good: Plain object
   return { temperature: 72, condition: 'sunny' };
   ```

---

### Session Drops / Reconnection Issues

**Symptoms:**
- Client repeatedly shows `reconnecting` then `failed`
- `SESSION_NOT_FOUND` errors on reconnect

**Log excerpt:**
```
Reconnect attempt 1/5...
Session abc123 not found
Reconnect attempt 2/5...
Max retries exceeded, connection failed
```

**Solutions:**
1. **Extend session TTL** for long-running applications:
   ```typescript
   const server = new LLMRTCServer({
     sessionTTL: 60 * 60 * 1000  // 1 hour instead of 30 min
   });
   ```

2. **Handle reconnection gracefully** on client:
   ```typescript
   client.on('stateChange', (state) => {
     if (state === 'failed') {
       // Start fresh session instead of reconnecting
       client.start();  // Creates new session
     }
   });
   ```

3. **Check heartbeat timeout** - Client should send pings:
   ```typescript
   // Server logs if no heartbeat received
   Heartbeat timeout for session abc123
   ```

---

### Rate Limiting

**Symptoms:**
- `RATE_LIMITED` error code
- Responses suddenly stop working

**Log excerpt:**
```
OpenAI API error: 429 Too Many Requests
Rate limit exceeded. Please retry after 60 seconds.
```

**Solutions:**
1. **Implement retry logic** with exponential backoff (built-in for LLM):
   ```typescript
   const server = new LLMRTCServer({
     llmRetries: 3  // Default: 3 retries with backoff
   });
   ```

2. **Reduce request rate** - Increase silence threshold, debounce inputs

3. **Use tiered API plans** from your provider

---

## Debug Techniques

### Browser DevTools

1. **Network tab → WS** to inspect WebSocket messages
2. Look for `error` message types with codes
3. Check for failed ICE candidates

### Server Logging

Enable verbose hooks for debugging:

```typescript
import { createVerboseHooks } from '@metered/llmrtc-core';

const server = new LLMRTCServer({
  hooks: createVerboseHooks()
});
```

Or create targeted logging:

```typescript
hooks: {
  onError: (error, context) => {
    console.error(`[${context}] Error:`, error);
  },
  onToolError: (ctx, request, error) => {
    console.error(`Tool ${request.name} failed:`, error);
    console.error('Arguments:', request.arguments);
  }
}
```

### Connection State Debugging

```typescript
client.on('stateChange', (state) => {
  console.log(`Connection state: ${state}`);
});

client.on('reconnecting', (attempt, max) => {
  console.log(`Reconnect attempt ${attempt}/${max}`);
});
```

---

## Related Documentation

- [Networking & TURN](../backend/networking-and-turn) - ICE/TURN configuration
- [Observability & Hooks](../backend/observability-and-hooks) - Logging and metrics
- [Logging & Metrics](logging-and-metrics) - Production monitoring
