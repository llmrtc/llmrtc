---
title: Tool Calling Quickstart
---

This quickstart shows how to define tools with JSON Schema, wire them to real functions, and let an LLM call them using the core SDK. It does **not** require the full voice/WebRTC stack.

## 1. Install packages

```bash
npm install @metered/llmrtc-core @metered/llmrtc-provider-openai
```

## 2. Define and register a tool

Example: a simple `get_weather` tool that calls your own API.

```ts
import {
  ToolRegistry,
  defineTool,
  type ToolDefinition
} from '@metered/llmrtc-core';

const registry = new ToolRegistry();

const getWeatherDef: ToolDefinition = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name, e.g. Tokyo' },
      units: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature units'
      }
    },
    required: ['city'],
    additionalProperties: false
  }
};

registry.register(
  defineTool(getWeatherDef, async ({ city, units }) => {
    const data = await fetch(`https://api.example.com/weather?city=${encodeURIComponent(city)}&units=${units ?? 'celsius'}`).then(r => r.json());
    return {
      city,
      temp: data.temp,
      units: units ?? 'celsius',
      condition: data.condition
    };
  })
);
```

## 3. Call the LLM with tools

```ts
import { OpenAILLMProvider } from '@metered/llmrtc-provider-openai';

const llm = new OpenAILLMProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o-mini'
});

const messages = [
  { role: 'user' as const, content: 'What is the weather in Tokyo in celsius?' }
];

let result = await llm.complete({
  messages,
  tools: registry.getDefinitions(),
  toolChoice: 'auto'
});
```

If the model decides to use tools, `result.stopReason` will be `'tool_use'` and `result.toolCalls` will contain one or more `ToolCallRequest` objects.

## 4. Execute tool calls with ToolExecutor

```ts
import { ToolExecutor } from '@metered/llmrtc-core';

const executor = new ToolExecutor(registry, {
  timeout: 30_000,
  maxConcurrency: 5,
  validateArguments: true
});

while (result.stopReason === 'tool_use' && result.toolCalls?.length) {
  // 1) Run tools
  const toolResults = await executor.execute(result.toolCalls, {
    sessionId: 'demo-session',
    turnId: 'turn-1'
  });

  // 2) Append assistant + tool messages
  messages.push({ role: 'assistant', content: result.fullText || '' });

  for (const r of toolResults) {
    messages.push({
      role: 'tool',
      content: JSON.stringify(r.result ?? { error: r.error }),
      toolCallId: r.callId,
      toolName: r.toolName
    });
  }

  // 3) Ask the model again, with updated history
  result = await llm.complete({
    messages,
    tools: registry.getDefinitions()
  });
}

console.log('Final answer:', result.fullText);
```

## 5. Next steps

- Add logging/metrics to tool execution using hooks (see Core SDK → Hooks & Metrics).
- Combine this pattern with Playbooks or VoicePlaybookOrchestrator for multi-stage voice flows.
- See Recipes → Weather Assistant and Support Bot for end-to-end examples using tools and playbooks.
