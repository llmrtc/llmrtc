---
title: Tools API
---

LLMRTC provides a complete tool system for defining, registering, and executing tools that LLMs can call.

---

## Defining Tools

Define tools with JSON Schema for consistent cross-provider compatibility:

```typescript
import { ToolDefinition } from '@llmrtc/llmrtc-core';

const weatherTool: ToolDefinition = {
  name: 'lookupWeather',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'City name'
      },
      units: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        default: 'celsius'
      }
    },
    required: ['city']
  },
  executionPolicy: 'parallel'  // Optional: 'sequential' | 'parallel'
};
```

### Execution Policy

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `parallel` (default) | Execute concurrently with other parallel tools | Independent lookups, API calls |
| `sequential` | Execute one at a time, in order | Database writes, stateful operations |

---

## Registering Tools

Use `ToolRegistry` and `defineTool` for type-safe registration:

```typescript
import { ToolRegistry, defineTool } from '@llmrtc/llmrtc-core';

// Create registry
const registry = new ToolRegistry();

// Register with typed handler
registry.register(
  defineTool<{ city: string; units?: string }, WeatherResult>(
    weatherTool,
    async ({ city, units = 'celsius' }) => {
      const data = await fetchWeatherAPI(city);
      return {
        city,
        temperature: units === 'celsius' ? data.tempC : data.tempF,
        units,
        condition: data.summary
      };
    }
  )
);

// Get a registered tool
const tool = registry.getTool('lookupWeather');

// Get definitions for LLM
const definitions = registry.getDefinitions();
```

---

## ToolExecutor

`ToolExecutor` handles tool execution with timeout, concurrency, and validation:

```typescript
import { ToolExecutor } from '@llmrtc/llmrtc-core';

const executor = new ToolExecutor(registry, {
  // Execution settings
  defaultPolicy: 'parallel',    // Default policy for tools without one
  maxConcurrency: 10,           // Max parallel executions (default: 10)
  timeout: 30000,               // Per-tool timeout in ms (default: 30000)
  validateArguments: true,      // Validate args against schema (default: true)

  // Callbacks
  onToolStart: (name, callId, args) => {
    console.log(`Starting ${name}:`, args);
  },
  onToolEnd: (result) => {
    console.log(`Completed ${result.toolName} in ${result.durationMs}ms`);
  },
  onToolError: (name, callId, error) => {
    console.error(`Tool ${name} failed:`, error);
  }
});
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `defaultPolicy` | `'parallel'` | Default execution policy when tool doesn't specify |
| `maxConcurrency` | `10` | Maximum concurrent tool executions |
| `timeout` | `30000` | Timeout per tool execution (ms) |
| `validateArguments` | `true` | Validate arguments against JSON Schema before execution |
| `onToolStart` | - | Called when tool execution starts |
| `onToolEnd` | - | Called when tool execution completes (success or failure) |
| `onToolError` | - | Called when tool execution fails |

### Execution Methods

```typescript
// Execute multiple tool calls (respects execution policies)
const results = await executor.execute(toolCalls, {
  sessionId: 'session-123',
  turnId: 'turn-456',
  abortSignal: controller.signal  // Optional abort signal
});

// Execute single tool call
const result = await executor.executeSingle(toolCall, context);
```

### Tool Call Result

```typescript
interface ToolCallResult {
  callId: string;           // Unique ID matching the request
  toolName: string;         // Tool name
  success: boolean;         // Whether execution succeeded
  result?: unknown;         // Tool return value (on success)
  error?: string;           // Error message (on failure)
  durationMs: number;       // Execution time in milliseconds
}
```

---

## Full Tool Loop Pattern

Complete pattern for handling LLM tool calls:

```typescript
const messages: Message[] = [{ role: 'user', content: 'What\'s the weather in Tokyo?' }];

let result = await llm.complete({
  messages,
  tools: registry.getDefinitions(),
  toolChoice: 'auto'  // 'auto' | 'required' | 'none'
});

// Loop while LLM requests tools
while (result.stopReason === 'tool_use' && result.toolCalls?.length) {
  // Execute all tool calls
  const toolResults = await executor.execute(result.toolCalls, {
    sessionId: 'demo',
    turnId: `turn-${Date.now()}`
  });

  // Add assistant message with tool calls
  messages.push({
    role: 'assistant',
    content: result.fullText || '',
    toolCalls: result.toolCalls
  });

  // Add tool result messages
  for (const r of toolResults) {
    messages.push({
      role: 'tool',
      content: JSON.stringify(r.result ?? { error: r.error }),
      toolCallId: r.callId,
      toolName: r.toolName
    });
  }

  // Continue with LLM
  result = await llm.complete({
    messages,
    tools: registry.getDefinitions()
  });
}

console.log('Final answer:', result.fullText);
```

---

## Argument Validation

Validate tool arguments manually:

```typescript
import { validateToolArguments } from '@llmrtc/llmrtc-core';

const validation = validateToolArguments(weatherTool, {
  city: 'Tokyo',
  units: 'invalid'  // Not in enum
});

if (!validation.valid) {
  console.log('Validation errors:', validation.errors);
  // ["units must be one of: celsius, fahrenheit"]
}
```

---

## Built-in Playbook Transition Tool

When using playbooks, LLMRTC provides a built-in `playbook_transition` tool:

```typescript
const PLAYBOOK_TRANSITION_TOOL: ToolDefinition = {
  name: 'playbook_transition',
  description: 'Transition to a different stage in the playbook',
  parameters: {
    type: 'object',
    properties: {
      targetStage: { type: 'string', description: 'Stage ID to transition to' },
      reason: { type: 'string', description: 'Why this transition is occurring' },
      data: { type: 'object', description: 'Optional data to pass to new stage' }
    },
    required: ['targetStage', 'reason']
  },
  executionPolicy: 'sequential'
};
```

---

## Best Practices

### Schema Design

```typescript
// GOOD: Strict schema with enums and constraints
{
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete'] },
      count: { type: 'integer', minimum: 1, maximum: 100 },
      date: { type: 'string', format: 'date' }
    },
    required: ['action']
  }
}

// BAD: Loose schema allows hallucinated values
{
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string' },
      count: { type: 'number' }
    }
  }
}
```

### Tool Choice

| Choice | When to Use |
|--------|-------------|
| `'auto'` | Default - LLM decides whether to call tools |
| `'required'` | Force tool use (compliance lookups, structured output) |
| `'none'` | Disable tools for this turn |

### Error Handling

```typescript
registry.register(
  defineTool(myTool, async (args) => {
    try {
      return await doWork(args);
    } catch (error) {
      // Return structured error for LLM to handle
      return {
        error: true,
        message: error.message,
        suggestion: 'Try with different parameters'
      };
    }
  })
);
```

---

## Related

- [Playbooks Overview](../playbooks/overview) - Tools in playbook context
- [Hooks & Metrics](hooks-and-metrics) - Tool execution observability
