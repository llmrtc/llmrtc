---
title: Error Codes
---

When errors occur, the server sends an `error` message with a structured code and human-readable message. This page documents all error codes.

---

## Error Codes Reference

| Code | Description | Retry? |
|------|-------------|--------|
| **Connection/Session** | | |
| `WEBRTC_UNAVAILABLE` | Server missing WebRTC support | No |
| `CONNECTION_FAILED` | Connection establishment failed | Yes |
| `SESSION_NOT_FOUND` | Reconnect with unknown session ID | No (start new session) |
| `SESSION_EXPIRED` | Session timed out due to inactivity | No (start new session) |
| **Provider Errors** | | |
| `STT_ERROR` | Speech-to-text provider failed | Yes (with backoff) |
| `STT_TIMEOUT` | STT processing exceeded timeout | Yes |
| `LLM_ERROR` | LLM provider failed | Yes (with backoff) |
| `LLM_TIMEOUT` | LLM response exceeded timeout | Yes |
| `TTS_ERROR` | Text-to-speech provider failed | Yes (with backoff) |
| `TTS_TIMEOUT` | TTS synthesis exceeded timeout | Yes |
| **Processing Errors** | | |
| `AUDIO_PROCESSING_ERROR` | Audio decoding or processing failed | No (check audio format) |
| `VAD_ERROR` | Voice activity detection failed | No (check audio format) |
| `INVALID_MESSAGE` | Malformed or unknown message type | No (fix client) |
| `INVALID_AUDIO_FORMAT` | Unsupported audio format | No (check format) |
| **Playbook/Tool Errors** | | |
| `TOOL_ERROR` | Tool execution failed | Maybe (depends on tool) |
| `PLAYBOOK_ERROR` | Playbook orchestration failed | No |
| **Generic Errors** | | |
| `INTERNAL_ERROR` | Unexpected server error | Yes (with backoff) |
| `RATE_LIMITED` | Too many requests | Yes (after delay) |

---

## Retry Guidance

**Safe to retry:**
- `CONNECTION_FAILED` - Network may have recovered
- `*_TIMEOUT` codes - Provider may be temporarily slow
- `RATE_LIMITED` - After respecting retry-after delay
- `INTERNAL_ERROR` - Transient server issues

**Not safe to retry (without changes):**
- `INVALID_MESSAGE` - Fix the message format
- `INVALID_AUDIO_FORMAT` - Fix the audio encoding
- `SESSION_NOT_FOUND` / `SESSION_EXPIRED` - Start a new session
- `TOOL_ERROR` - May need different parameters

**Exponential backoff recommended:** Start with 1 second, double each retry, max 5 retries.

---

## Error Message Format

```typescript
interface ErrorMessage {
  type: 'error';
  code: ErrorCode;    // One of the codes above
  message: string;    // Human-readable description
}
```

Example:
```json
{
  "type": "error",
  "code": "LLM_TIMEOUT",
  "message": "LLM response exceeded 30 second timeout"
}
```

---

## Client Handling

```typescript
client.on('error', (error) => {
  switch (error.code) {
    case 'RATE_LIMITED':
      // Wait and retry
      setTimeout(() => client.start(), 60000);
      break;

    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
      // Start fresh session
      client.start();
      break;

    case 'LLM_TIMEOUT':
    case 'STT_TIMEOUT':
    case 'TTS_TIMEOUT':
      // Retry with backoff
      showMessage('Processing took too long, retrying...');
      break;

    default:
      // Show user-friendly message
      showMessage(`Error: ${error.message}`);
  }
});
```
