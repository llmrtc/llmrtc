---
title: Tool Calling
---

Define provider-agnostic tools with JSON Schema and let models call them.

- **ToolDefinition**: `{ name, description, parameters, executionPolicy }`
- **ToolChoice**: `auto | none | required | { name }`
- **ToolCallRequest**: emitted by LLM provider; includes `callId`, `name`, `arguments`.

Flow
1) Pass `tools` and optional `toolChoice` to an LLM request.
2) Provider returns tool call(s) in the response or stream.
3) Execute tools in your app/backend; send results back as `tool` role messages.
4) Continue the turn for final response.

Guidelines
- Keep schemas strict; prefer enums and min/max constraints to reduce hallucinated args.
- Use `executionPolicy: parallel` only for independent tools.
- Log tool calls for observability and debugging.
