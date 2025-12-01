# Weather Assistant Example

A voice-enabled weather assistant demonstrating tool calling with VoicePlaybookOrchestrator.

## Features

- **Voice interaction** - Talk to ask about weather
- **Tool calling** - Real-time tool execution shown in UI
- **Single-stage playbook** - Simple tool-calling setup without complex transitions

## Tools

| Tool | Description |
|------|-------------|
| `get_weather` | Get current weather conditions for a city |
| `get_forecast` | Get multi-day weather forecast |
| `get_alerts` | Get active weather alerts |

## Setup

1. Copy environment file and add your API keys:
   ```bash
   cp .env.example .env
   # Edit .env with your keys
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser

## Try It

Say things like:
- "What's the weather in Tokyo?"
- "Give me the forecast for New York"
- "Are there any weather alerts in Miami?"
- "What's the temperature in London in Fahrenheit?"

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              React Client (main.tsx)                 │   │
│  │  - Speech capture via microphone                     │   │
│  │  - Tool call events displayed in real-time          │   │
│  │  - TTS playback via WebRTC                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebRTC + WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     server.ts                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              LLMRTCServer (playbook mode)            │   │
│  │  - VoicePlaybookOrchestrator                        │   │
│  │  - ToolRegistry with weather tools                  │   │
│  │  - Streaming LLM + TTS                              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Code Highlights

### Server - Tool Definition

```typescript
const getWeatherTool = defineTool(
  {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'] }
      },
      required: ['city']
    }
  },
  async (params) => {
    // Tool implementation - returns weather data
    return { temp: 72, humidity: 65, condition: 'sunny' };
  }
);
```

### Client - Tool Event Handling

```typescript
client.on('toolCallStart', ({ name, callId, arguments: args }) => {
  // Show loading indicator for this tool
  setToolCalls(prev => [...prev, { callId, name, status: 'running' }]);
});

client.on('toolCallEnd', ({ callId, result, error }) => {
  // Update tool status with result
  setToolCalls(prev => prev.map(tc =>
    tc.callId === callId ? { ...tc, status: 'complete', result } : tc
  ));
});
```
