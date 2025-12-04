---
title: Tools API
---

Define tools with JSON Schema so all providers can call them consistently.

```ts
import { ToolDefinition } from '@metered/llmrtc-core';

const weather: ToolDefinition = {
  name: 'lookupWeather',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city']
  }
};
```

### Register tools

```ts
import { ToolRegistry, defineTool } from '@metered/llmrtc-core';

const registry = new ToolRegistry();

registry.register(
  defineTool(weather, async ({ city }) => {
    const data = await fetchWeather(city);
    return { city, tempC: data.tempC, condition: data.summary };
  })
);
```

### Execute tools with ToolExecutor

```ts
import { ToolExecutor } from '@metered/llmrtc-core';

const executor = new ToolExecutor(registry, {
  timeout: 30_000,
  maxConcurrency: 5,
  validateArguments: true
});
```

### Full tool loop pattern

```ts
const messages = [{ role: 'user', content: 'Weather in Tokyo?' }];

let result = await llm.complete({
  messages,
  tools: registry.getDefinitions(),
  toolChoice: 'auto'
});

while (result.stopReason === 'tool_use' && result.toolCalls?.length) {
  const toolResults = await executor.execute(result.toolCalls, { sessionId: 'demo' });

  messages.push({ role: 'assistant', content: result.fullText || '' });
  for (const r of toolResults) {
    messages.push({
      role: 'tool',
      content: JSON.stringify(r.result ?? r.error),
      toolCallId: r.callId,
      toolName: r.toolName
    });
  }

  result = await llm.complete({ messages, tools: registry.getDefinitions() });
}

console.log('Final answer:', result.fullText);
```

### Best practices
- Keep schemas strict (enums, min/max) to reduce hallucinated args.
- Use `toolChoice: 'required'` when you must force tool usage (e.g., compliance lookups).
- Log tool calls with arguments and duration for debugging and cost attribution.
- For parallel-safe tools, set `executionPolicy: 'parallel'`; otherwise keep sequential.
