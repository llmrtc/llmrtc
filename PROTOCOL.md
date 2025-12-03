# @metered/llmrtc Wire Protocol v1

This document specifies the JSON message format exchanged between the `@metered/llmrtc-web-client` and `@metered/llmrtc-backend` over WebSocket and WebRTC data channel.

## Protocol Version

**Current Version:** `1`

The protocol version is exchanged during the connection handshake in the `ready` message. Clients should verify the server's protocol version and warn or fail if there's a mismatch.

```typescript
import { PROTOCOL_VERSION } from '@metered/llmrtc-core';
// PROTOCOL_VERSION = 1
```

## Connection Lifecycle

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  ──────── WebSocket Connect ──────────► │
     │                                         │
     │  ◄─────────── ready ───────────────────┤
     │  {type: "ready", id, protocolVersion}   │
     │                                         │
     │  ──────────── offer ──────────────────► │
     │  {type: "offer", signal: SDP}           │
     │                                         │
     │  ◄─────────── signal ──────────────────┤
     │  {type: "signal", signal: SDP}          │
     │                                         │
     │  ═══════ WebRTC Data Channel ══════════ │
     │                                         │
     │  ──────────── ping ───────────────────► │
     │  {type: "ping", timestamp}              │
     │                                         │
     │  ◄─────────── pong ───────────────────┤
     │  {type: "pong", timestamp}              │
     │                                         │
```

## Transport Channels

Messages are sent over two channels:

1. **WebSocket** - Used for signaling (offer, signal, ping/pong, reconnect)
2. **WebRTC Data Channel** - Used for low-latency payload messages (transcript, llm, tts events)

The server sends payload messages to **both** channels. The client should only process from one channel (prefer DataChannel when connected).

---

## Message Reference

### Client → Server Messages

#### `ping`
Heartbeat message sent every 15 seconds to keep the connection alive.

```typescript
{
  type: "ping";
  timestamp: number;  // Date.now() for RTT calculation
}
```

#### `offer`
WebRTC SDP offer to initiate peer connection.

```typescript
{
  type: "offer";
  signal: RTCSessionDescriptionInit;  // SDP offer
}
```

#### `reconnect`
Request to recover a previous session after disconnect.

```typescript
{
  type: "reconnect";
  sessionId: string;  // Previous session ID
}
```

#### `audio`
Audio data for transcription (legacy/fallback when WebRTC audio track unavailable).

```typescript
{
  type: "audio";
  data: string;  // Base64-encoded audio (WAV)
  attachments?: VisionAttachment[];  // Optional images
}
```

#### `attachments`
Vision attachments sent via data channel, queued for next speech segment.

```typescript
{
  type: "attachments";
  attachments: VisionAttachment[];
}

interface VisionAttachment {
  data: string;      // Base64 data URI or URL
  mimeType?: string; // e.g., "image/jpeg"
  alt?: string;      // Accessibility text
}
```

---

### Server → Client Messages

#### `ready`
Connection established notification with session ID, protocol version, and ICE servers.

```typescript
{
  type: "ready";
  id: string;               // Session ID
  protocolVersion: number;  // Protocol version (currently 1)
  iceServers?: RTCIceServer[]; // ICE servers for WebRTC (STUN/TURN)
}
```

The `iceServers` field contains STUN/TURN server configurations fetched from Metered or configured on the server. Clients should use these for WebRTC peer connection unless they have their own ICE server configuration.

#### `pong`
Heartbeat response echoing client timestamp.

```typescript
{
  type: "pong";
  timestamp: number;  // Echoed from ping
}
```

#### `signal`
WebRTC SDP answer in response to client's offer.

```typescript
{
  type: "signal";
  signal: RTCSessionDescriptionInit;  // SDP answer
}
```

#### `reconnect-ack`
Session reconnection acknowledgment.

```typescript
{
  type: "reconnect-ack";
  success: boolean;
  sessionId: string;
  historyRecovered: boolean;  // Whether conversation history was recovered
}
```

#### `transcript`
Speech-to-text transcription result.

```typescript
{
  type: "transcript";
  text: string;     // Transcribed text
  isFinal: boolean; // Whether this is the final transcription
}
```

#### `llm-chunk`
Streaming LLM response chunk.

```typescript
{
  type: "llm-chunk";
  content: string;  // Partial response content
  done: boolean;    // Whether this is the final chunk
}
```

#### `llm`
Complete LLM response.

```typescript
{
  type: "llm";
  text: string;  // Full response text
}
```

#### `tts-start`
TTS audio playback is starting.

```typescript
{
  type: "tts-start";
}
```

#### `tts-chunk`
Streaming TTS audio chunk (when WebRTC audio track unavailable).

```typescript
{
  type: "tts-chunk";
  format: string;     // Audio format (e.g., "pcm", "mp3")
  sampleRate: number; // Sample rate in Hz
  data: string;       // Base64-encoded audio
}
```

#### `tts`
Complete TTS audio (non-streaming fallback).

```typescript
{
  type: "tts";
  format: string;  // Audio format
  data: string;    // Base64-encoded audio
}
```

#### `tts-complete`
TTS audio playback finished.

```typescript
{
  type: "tts-complete";
}
```

#### `tts-cancelled`
TTS audio playback was cancelled (user interrupted / barge-in).

```typescript
{
  type: "tts-cancelled";
}
```

#### `speech-start`
VAD detected user started speaking.

```typescript
{
  type: "speech-start";
}
```

#### `speech-end`
VAD detected user stopped speaking.

```typescript
{
  type: "speech-end";
}
```

---

### Playbook Mode Events

These messages are sent when using the PlaybookOrchestrator for tool-calling workflows.

#### `tool-call-start`
A tool is being executed.

```typescript
{
  type: "tool-call-start";
  name: string;                      // Tool function name
  callId: string;                    // Unique call ID for correlation
  arguments: Record<string, unknown>; // Arguments passed to the tool
}
```

#### `tool-call-end`
Tool execution completed.

```typescript
{
  type: "tool-call-end";
  callId: string;   // Matches tool-call-start callId
  result?: unknown; // Tool result (on success)
  error?: string;   // Error message (on failure)
  durationMs: number; // Execution duration in milliseconds
}
```

#### `stage-change`
Playbook transitioned to a different stage.

```typescript
{
  type: "stage-change";
  from: string;   // Previous stage name
  to: string;     // New stage name
  reason: string; // Reason for transition (e.g., "tool_result", "keyword_match")
}
```

---

#### `error`
Error notification with structured error code.

```typescript
{
  type: "error";
  code: ErrorCode;   // Structured error code
  message: string;   // Human-readable description
}
```

---

## Error Codes

Error codes are grouped by category for easier identification:

### WebRTC/Connection Errors

| Code | Description |
|------|-------------|
| `WEBRTC_UNAVAILABLE` | Server lacks WebRTC support (missing @roamhq/wrtc) |
| `CONNECTION_FAILED` | WebRTC or WebSocket connection failed |
| `SESSION_NOT_FOUND` | Reconnect with invalid session ID |
| `SESSION_EXPIRED` | Session timed out and was cleaned up |

### Provider Errors

| Code | Description |
|------|-------------|
| `STT_ERROR` | Speech-to-text provider error |
| `STT_TIMEOUT` | Speech-to-text operation timed out |
| `LLM_ERROR` | LLM provider error |
| `LLM_TIMEOUT` | LLM operation timed out |
| `TTS_ERROR` | Text-to-speech provider error |
| `TTS_TIMEOUT` | Text-to-speech operation timed out |

### Processing Errors

| Code | Description |
|------|-------------|
| `AUDIO_PROCESSING_ERROR` | VAD or audio decoding failed |
| `VAD_ERROR` | Voice activity detection error |
| `INVALID_MESSAGE` | Malformed or unknown message type |
| `INVALID_AUDIO_FORMAT` | Audio format not supported |

### Playbook/Tool Errors

| Code | Description |
|------|-------------|
| `TOOL_ERROR` | Tool execution failed |
| `PLAYBOOK_ERROR` | Playbook orchestration error |

### Generic Errors

| Code | Description |
|------|-------------|
| `INTERNAL_ERROR` | Unexpected server error |
| `RATE_LIMITED` | Request rate limit exceeded |

---

## Message Flow Examples

### Voice Conversation Turn

```
Client                                    Server
   │                                         │
   │  ──── (WebRTC audio track) ───────────► │
   │                                         │
   │  ◄──────── speech-start ───────────────┤
   │                                         │
   │  ◄──────── speech-end ─────────────────┤
   │                                         │
   │  ◄──────── transcript ─────────────────┤
   │  {text: "Hello", isFinal: true}         │
   │                                         │
   │  ◄──────── llm-chunk ──────────────────┤
   │  {content: "Hi", done: false}           │
   │                                         │
   │  ◄──────── llm-chunk ──────────────────┤
   │  {content: " there!", done: true}       │
   │                                         │
   │  ◄──────── llm ────────────────────────┤
   │  {text: "Hi there!"}                    │
   │                                         │
   │  ◄──────── tts-start ──────────────────┤
   │                                         │
   │  ◄──── (WebRTC audio track) ────────────┤
   │                                         │
   │  ◄──────── tts-complete ───────────────┤
   │                                         │
```

### Barge-in (User Interruption)

```
Client                                    Server
   │                                         │
   │  ◄──────── tts-start ──────────────────┤
   │                                         │
   │  ◄──── (TTS audio playing) ─────────────┤
   │                                         │
   │  ──── (User starts speaking) ──────────► │
   │                                         │
   │  ◄──────── speech-start ───────────────┤
   │                                         │
   │  ◄──────── tts-cancelled ──────────────┤
   │                                         │
   │  ◄──────── speech-end ─────────────────┤
   │                                         │
   │  ◄──────── transcript ─────────────────┤
   │                                         │
```

### Session Reconnection

```
Client                                    Server
   │                                         │
   │  ──────── WebSocket Reconnect ────────► │
   │                                         │
   │  ◄─────────── ready ───────────────────┤
   │  {id: "new-conn-id", protocolVersion: 1}│
   │                                         │
   │  ──────────── reconnect ──────────────► │
   │  {sessionId: "previous-session-id"}     │
   │                                         │
   │  ◄──────── reconnect-ack ──────────────┤
   │  {success: true, historyRecovered: true}│
   │                                         │
```

### Playbook Mode with Tool Calls

```
Client                                    Server
   │                                         │
   │  ──── "Book a table for 2" ──────────► │
   │                                         │
   │  ◄──────── transcript ─────────────────┤
   │  {text: "Book a table for 2"}           │
   │                                         │
   │  ◄──────── llm-chunk ──────────────────┤
   │  {content: "I'll book", done: false}    │
   │                                         │
   │  ◄──────── tool-call-start ────────────┤
   │  {name: "bookTable", callId: "xyz"}     │
   │                                         │
   │  ◄──────── tool-call-end ──────────────┤
   │  {callId: "xyz", result: {...}}         │
   │                                         │
   │  ◄──────── stage-change ───────────────┤
   │  {from: "greeting", to: "confirmation"} │
   │                                         │
   │  ◄──────── llm-chunk ──────────────────┤
   │  {content: "Done!", done: true}         │
   │                                         │
   │  ◄──────── tts-start ──────────────────┤
   │                                         │
```

---

## TypeScript Types

All message types are exported from `@metered/llmrtc-core`:

```typescript
import {
  // Protocol version
  PROTOCOL_VERSION,

  // Message types
  ClientMessage,
  ServerMessage,
  ProtocolMessage,

  // Individual message interfaces
  PingMessage,
  PongMessage,
  OfferMessage,
  SignalMessage,
  ReadyMessage,
  ReconnectMessage,
  ReconnectAckMessage,
  AudioMessage,
  AttachmentsMessage,
  TranscriptMessage,
  LLMChunkMessage,
  LLMMessage,
  TTSStartMessage,
  TTSChunkMessage,
  TTSMessage,
  TTSCompleteMessage,
  TTSCancelledMessage,
  SpeechStartMessage,
  SpeechEndMessage,
  ToolCallStartMessage,
  ToolCallEndMessage,
  StageChangeMessage,
  ErrorMessage,
  ErrorCode,

  // Type guards
  isClientMessage,
  isServerMessage,
  isErrorMessage,
  parseMessage,

  // Message constructors
  createReadyMessage,
  createErrorMessage,
  createTranscriptMessage,
  createLLMChunkMessage,
  createLLMMessage,
  createTTSChunkMessage,
  createTTSMessage,
  createToolCallStartMessage,
  createToolCallEndMessage,
  createStageChangeMessage
} from '@metered/llmrtc-core';
```

---

## Compatibility Notes

- Protocol version is checked at connection time via the `ready` message
- If server version differs from client, a warning is logged (connection proceeds)
- Future versions may add new message types while maintaining backwards compatibility
- Unknown message types should be ignored (not treated as errors)
