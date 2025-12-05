---
title: Tool Calling
---

**Tool calling** (also known as function calling) allows language models to invoke functions in your application. Instead of just generating text, the model can request actions—checking weather, booking appointments, querying databases.

---

## How Tool Calling Works

When you provide tools to an LLM, it can decide to call them based on the conversation:

```mermaid
sequenceDiagram
    participant User
    participant LLM
    participant App
    participant Tool

    User->>LLM: "What's the weather in Tokyo?"
    LLM->>App: Tool call: get_weather({city: "Tokyo"})
    App->>Tool: Execute function
    Tool-->>App: {temp: 22, condition: "sunny"}
    App->>LLM: Tool result
    LLM->>User: "It's 22°C and sunny in Tokyo!"
```

The model doesn't execute tools itself—it generates structured requests that your application fulfills.

---

## Tool Definition

Tools are defined with a name, description, and JSON Schema parameters:

```mermaid
flowchart LR
    subgraph ToolDefinition
        NAME[name: get_weather]
        DESC[description: Get current weather]
        PARAMS[parameters: JSON Schema]
        POLICY[executionPolicy: parallel]
    end
```

The key components:

| Field | Purpose |
|-------|---------|
| `name` | Identifier the model uses to call the tool |
| `description` | Helps the model understand when to use it |
| `parameters` | JSON Schema defining expected arguments |
| `executionPolicy` | `sequential` or `parallel` execution |

The description is critical—it guides the model's decision to use the tool.

---

## Tool Execution Flow

When the model requests a tool call, this is what happens:

```mermaid
flowchart TD
    REQ[LLM Request with Tools] --> LLM[Language Model]
    LLM --> CHECK{Response type?}

    CHECK -->|Text| TEXT[Return text response]
    CHECK -->|Tool call| PARSE[Parse tool request]

    PARSE --> VALIDATE[Validate arguments]
    VALIDATE --> EXEC[Execute tool function]
    EXEC --> RESULT[Tool result]
    RESULT --> HISTORY[Add to history]
    HISTORY --> LLM2[Continue LLM turn]
```

Tool calls and results become part of the conversation history, allowing the model to reason about them.

---

## Tool Choice

You can control when the model uses tools:

| Choice | Behavior |
|--------|----------|
| `auto` | Model decides whether to call tools (default) |
| `none` | Model won't call any tools |
| `required` | Model must call at least one tool |
| `{ name: "tool_name" }` | Model must call the specified tool |

```mermaid
flowchart LR
    subgraph "Tool Choice Options"
        AUTO[auto] --> DECIDE{Model decides}
        NONE[none] --> TEXT[Text only]
        REQ[required] --> MUST[Must use tools]
        SPEC[specific] --> ONE[Call named tool]
    end
```

---

## Execution Policies

Tools can run sequentially or in parallel:

### Sequential Execution

```mermaid
flowchart LR
    T1[Tool 1] --> T2[Tool 2] --> T3[Tool 3]
```

Use when tools depend on each other's results.

### Parallel Execution

```mermaid
flowchart LR
    START[Start] --> T1[Tool 1]
    START --> T2[Tool 2]
    START --> T3[Tool 3]
    T1 --> END[Continue]
    T2 --> END
    T3 --> END
```

Use when tools are independent—faster total execution time.

The `executionPolicy` is set per-tool, allowing mixed strategies.

---

## Tool Loop

In complex scenarios, the model may call multiple tools before responding:

```mermaid
flowchart TD
    START[User Message] --> LLM1[LLM Call]
    LLM1 --> CHECK1{Tool calls?}

    CHECK1 -->|Yes| EXEC1[Execute Tools]
    EXEC1 --> LLM2[LLM Call with Results]
    LLM2 --> CHECK2{More tool calls?}

    CHECK2 -->|Yes| EXEC2[Execute Tools]
    EXEC2 --> LLM3[LLM Call with Results]
    LLM3 --> CHECK3{More tool calls?}

    CHECK1 -->|No| RESPONSE
    CHECK2 -->|No| RESPONSE
    CHECK3 -->|No| RESPONSE[Final Response]
```

This loop continues until the model produces a text response or hits the maximum tool calls limit.

---

## Tools in Voice AI

For voice applications, tool calling integrates with the speech pipeline:

```mermaid
sequenceDiagram
    participant User
    participant VAD
    participant STT
    participant LLM
    participant Tools
    participant TTS

    User->>VAD: Speech
    VAD->>STT: Audio
    STT->>LLM: "Book a table for 7pm"

    LLM->>Tools: check_availability(time: "7pm")
    Tools-->>LLM: {available: true}

    LLM->>Tools: make_reservation(time: "7pm")
    Tools-->>LLM: {confirmation: "ABC123"}

    LLM->>TTS: "Done! Confirmation ABC123"
    TTS->>User: Audio response
```

With [playbooks](playbooks), you can run tools silently in Phase 1, then generate the spoken response in Phase 2.

---

## Tool Results in History

Tool calls and results are stored as messages in conversation history:

```mermaid
flowchart TB
    subgraph History
        direction TB
        U[User: Book for 7pm]
        TC[Tool Call: check_availability]
        TR[Tool Result: available=true]
        TC2[Tool Call: make_reservation]
        TR2[Tool Result: confirmed]
        A[Assistant: All set!]
    end
```

This context helps the model understand what actions were taken and reference them later.

---

## Related Documentation

- [Core SDK Tools](../core-sdk/tools) - Tool definition and execution APIs
- [Playbooks](playbooks) - Multi-stage conversations with tools
- [Two-Phase Execution](../playbooks/overview#two-phase-execution-model) - Silent tool loop + response
- [Providers](providers) - Provider-specific tool calling support
