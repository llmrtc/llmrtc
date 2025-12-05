---
title: Message Types
---

All messages are JSON objects with a `type` field. Messages are sent over WebSocket and/or WebRTC data channel.

## Client → Server Messages

### `ping`
Heartbeat to keep connection alive. Server responds with `pong`.

```typescript
{
  type: 'ping',
  timestamp: number  // Date.now() for RTT calculation
}
```

### `offer`
WebRTC SDP offer to initiate peer connection.

```typescript
{
  type: 'offer',
  signal: RTCSessionDescriptionInit  // From RTCPeerConnection.createOffer()
}
```

### `reconnect`
Attempt to recover a previous session after disconnect.

```typescript
{
  type: 'reconnect',
  sessionId: string  // Previous session ID to recover
}
```

### `audio`
Audio data for transcription (fallback when WebRTC audio track unavailable).

```typescript
{
  type: 'audio',
  data: string,                    // Base64-encoded audio (WAV/WebM)
  attachments?: VisionAttachment[] // Optional images to include
}
```

### `attachments`
Vision attachments sent via data channel, queued for next speech segment.

```typescript
{
  type: 'attachments',
  attachments: VisionAttachment[]  // Array of { data, mimeType?, alt? }
}
```

---

## Server → Client Messages

### `ready`
Sent immediately after WebSocket connection. Contains session info and ICE servers for WebRTC.

```typescript
{
  type: 'ready',
  id: string,                      // Unique session ID assigned by server
  protocolVersion: number,         // Currently 1
  iceServers?: RTCIceServer[]      // STUN/TURN servers for WebRTC connection
}
```

**ICE Servers:** The `iceServers` array contains STUN and TURN server configurations that the client should use when creating its `RTCPeerConnection`. This enables the server to centrally manage ICE configuration, including Metered TURN credentials.

Example with Metered TURN:
```json
{
  "type": "ready",
  "id": "abc123",
  "protocolVersion": 1,
  "iceServers": [
    { "urls": "stun:stun.metered.ca:80" },
    { "urls": "turn:global.relay.metered.ca:80", "username": "abc", "credential": "xyz" },
    { "urls": "turn:global.relay.metered.ca:443?transport=tcp", "username": "abc", "credential": "xyz" }
  ]
}
```

See [Networking & TURN](../backend/networking-and-turn) for configuration details.

### `pong`
Response to `ping`. Echoes timestamp for RTT calculation.

```typescript
{
  type: 'pong',
  timestamp: number  // Echoed from ping message
}
```

### `signal`
WebRTC SDP answer in response to client's offer.

```typescript
{
  type: 'signal',
  signal: RTCSessionDescriptionInit  // SDP answer
}
```

### `reconnect-ack`
Response to `reconnect` request.

```typescript
{
  type: 'reconnect-ack',
  success: boolean,        // Whether reconnection succeeded
  sessionId: string,       // Session ID (may be new if original expired)
  historyRecovered: boolean // Whether conversation history was restored
}
```

---

## Conversation Flow Messages

### `transcript`
Speech-to-text transcription result.

```typescript
{
  type: 'transcript',
  text: string,       // Transcribed text
  isFinal: boolean    // true when transcription is complete
}
```

### `llm-chunk`
Streaming LLM response chunk.

```typescript
{
  type: 'llm-chunk',
  content: string,    // Partial response text
  done: boolean       // true for final chunk
}
```

### `llm`
Complete LLM response (non-streaming mode).

```typescript
{
  type: 'llm',
  text: string        // Full response text
}
```

---

## TTS Messages

### `tts-start`
TTS synthesis is starting. Sent before first audio chunk.

```typescript
{
  type: 'tts-start'
}
```

### `tts-chunk`
Streaming TTS audio chunk.

```typescript
{
  type: 'tts-chunk',
  format: string,     // 'pcm' | 'mp3' | 'ogg' | 'wav'
  sampleRate: number, // e.g., 24000
  data: string        // Base64-encoded audio data
}
```

**Note:** When WebRTC audio track is available, TTS audio is sent directly over the track instead of via `tts-chunk` messages.

### `tts`
Complete TTS audio (non-streaming mode).

```typescript
{
  type: 'tts',
  format: string,     // 'mp3' | 'wav' | 'ogg'
  data: string        // Base64-encoded audio data
}
```

### `tts-complete`
TTS playback finished successfully.

```typescript
{
  type: 'tts-complete'
}
```

### `tts-cancelled`
TTS playback was interrupted (user barge-in).

```typescript
{
  type: 'tts-cancelled'
}
```

---

## Speech Detection Messages

### `speech-start`
VAD detected user started speaking.

```typescript
{
  type: 'speech-start'
}
```

### `speech-end`
VAD detected user stopped speaking. Processing begins.

```typescript
{
  type: 'speech-end'
}
```

---

## Playbook Messages

These messages are only sent when using playbook mode with tool calling.

### `tool-call-start`
Tool execution is starting.

```typescript
{
  type: 'tool-call-start',
  name: string,                        // Tool function name
  callId: string,                      // Unique ID for correlation
  arguments: Record<string, unknown>   // Arguments passed to tool
}
```

### `tool-call-end`
Tool execution completed.

```typescript
{
  type: 'tool-call-end',
  callId: string,          // Matches tool-call-start
  result?: unknown,        // Tool result (on success)
  error?: string,          // Error message (on failure)
  durationMs: number       // Execution time in milliseconds
}
```

### `stage-change`
Playbook transitioned to a new stage.

```typescript
{
  type: 'stage-change',
  from: string,            // Previous stage ID
  to: string,              // New stage ID
  reason: string           // Why transition occurred
}
```

---

## Error Messages

### `error`
Server-side error occurred.

```typescript
{
  type: 'error',
  code: ErrorCode,         // Structured error code
  message: string          // Human-readable description
}
```

**Error Codes:**

| Code | Description |
|------|-------------|
| `WEBRTC_UNAVAILABLE` | WebRTC not supported on server |
| `CONNECTION_FAILED` | WebRTC connection failed |
| `SESSION_NOT_FOUND` | Session ID not found for reconnect |
| `SESSION_EXPIRED` | Session expired (TTL exceeded) |
| `STT_ERROR` | Speech-to-text failed |
| `STT_TIMEOUT` | STT request timed out |
| `LLM_ERROR` | LLM inference failed |
| `LLM_TIMEOUT` | LLM request timed out |
| `TTS_ERROR` | Text-to-speech failed |
| `TTS_TIMEOUT` | TTS request timed out |
| `AUDIO_PROCESSING_ERROR` | Audio processing failed |
| `VAD_ERROR` | Voice activity detection failed |
| `INVALID_MESSAGE` | Malformed message received |
| `INVALID_AUDIO_FORMAT` | Unsupported audio format |
| `TOOL_ERROR` | Tool execution failed |
| `PLAYBOOK_ERROR` | Playbook execution error |
| `INTERNAL_ERROR` | Unexpected server error |
| `RATE_LIMITED` | Too many requests |

---

## Type Definitions

```typescript
interface VisionAttachment {
  data: string;        // Base64 data URI or URL
  mimeType?: string;   // e.g., 'image/jpeg'
  alt?: string;        // Description for accessibility
}

interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
```

## Related

- [Connection Lifecycle](connection-lifecycle) - Message flow during connection
- [Message Flows](message-flows) - Sequence diagrams for common operations
- [Error Codes](error-codes) - Detailed error code reference
