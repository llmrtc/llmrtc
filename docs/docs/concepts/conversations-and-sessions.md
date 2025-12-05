---
title: Conversations & Sessions
---

A **conversation** is a sequence of exchanges between a user and an AI assistant. A **session** is the container that holds a conversation's state, history, and connection context.

---

## What is a Session?

When a user connects to LLMRTC, the server creates a session that:

- Assigns a unique **session ID** for identification
- Maintains **conversation history** (messages exchanged so far)
- Tracks **connection state** (WebSocket, WebRTC)
- Enables **reconnection** if the network drops

```mermaid
stateDiagram-v2
    [*] --> Created: Client connects
    Created --> Active: WebRTC established
    Active --> Active: Conversation turns
    Active --> Suspended: Connection lost
    Suspended --> Active: Reconnect success
    Suspended --> Expired: TTL exceeded
    Expired --> [*]
```

---

## Conversation History

Every session maintains a rolling history of messages:

```mermaid
flowchart LR
    subgraph History["Conversation History"]
        S[System Prompt]
        U1[User: Hello]
        A1[Assistant: Hi there!]
        U2[User: What's the weather?]
        T1[Tool: get_weather]
        T2[Tool Result]
        A2[Assistant: It's sunny...]
    end

    S --> U1 --> A1 --> U2 --> T1 --> T2 --> A2
```

History serves two purposes:

1. **Context for the LLM** - The model sees previous exchanges to maintain coherent conversation
2. **Continuity on reconnect** - Users can resume where they left off after network issues

The `historyLimit` setting controls how many messages are retained. When exceeded, older messages are trimmed while preserving the integrity of tool call/result pairs.

---

## Session Lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server

    C->>S: WebSocket connect
    S->>S: Create session
    S-->>C: ready { id: "abc123", protocolVersion: 1 }

    Note over C,S: Conversation happens...

    C->>S: Connection lost

    Note over S: Session stays alive (TTL)

    C->>S: reconnect { sessionId: "abc123" }
    alt Session exists
        S-->>C: reconnect-ack { success: true, historyRecovered: true }
    else Session expired
        S->>S: Create new session
        S-->>C: reconnect-ack { success: false, sessionId: "xyz789" }
    end
```

Sessions have a **time-to-live (TTL)**. If a disconnected user doesn't reconnect within this window, the session expires and history is lost.

---

## Multi-Turn Conversations

A conversation consists of multiple **turns**. Each turn follows this pattern:

```mermaid
flowchart LR
    U[User speaks] --> STT[Transcribe]
    STT --> LLM[Generate response]
    LLM --> TTS[Synthesize speech]
    TTS --> A[Assistant speaks]
    A --> U
```

Within a turn, the orchestrator:
1. Receives user input (audio or text)
2. Transcribes to text (STT)
3. Adds to conversation history
4. Sends history to LLM
5. Gets response
6. Synthesizes speech (TTS)
7. Adds assistant response to history

---

## Conversations in Playbooks

When using [playbooks](playbooks), conversations gain additional structure:

- **Stages** - Conversation moves through defined phases
- **Stage-specific history** - Each stage can have its own context
- **Transitions** - Rules that move between stages based on conversation content

```mermaid
flowchart LR
    subgraph Conversation
        G[Greeting Stage] --> A[Auth Stage]
        A --> T[Triage Stage]
        T --> R[Resolution Stage]
        R --> F[Farewell Stage]
    end
```

---

## Related Documentation

- [Architecture Overview](architecture) - How sessions fit in the system
- [Connection Lifecycle](../web-client/connection-lifecycle) - Client-side connection handling
- [Protocol Messages](../protocol/message-types) - Session-related message formats
- [Backend Configuration](../backend/configuration) - Session TTL and history settings
