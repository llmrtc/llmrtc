---
title: Orchestrator
---

The **orchestrator** is the central coordinator that manages a conversation turn - receiving user input, processing it through providers, and producing a response.

---

## What Does an Orchestrator Do?

An orchestrator connects the pieces of a voice AI system:

```mermaid
flowchart LR
    subgraph Orchestrator
        direction TB
        INPUT[User Input] --> STT[Speech-to-Text]
        STT --> HISTORY[Add to History]
        HISTORY --> LLM[Language Model]
        LLM --> TTS[Text-to-Speech]
        TTS --> OUTPUT[Audio Response]
    end

    MIC[Microphone] --> INPUT
    OUTPUT --> SPK[Speaker]
```

The orchestrator:
1. **Coordinates providers** - Routes data between STT, LLM, and TTS
2. **Manages history** - Maintains conversation context across turns
3. **Handles streaming** - Enables low-latency response delivery
4. **Processes attachments** - Includes images/vision when available

---

## Types of Orchestrators

LLMRTC provides two orchestrator types for different use cases:

### ConversationOrchestrator

Simple, linear pipeline for basic voice assistants:

```mermaid
flowchart LR
    A[Audio] --> B[STT] --> C[LLM] --> D[TTS] --> E[Audio]
```

- Single system prompt
- No tool support
- Best for: Simple Q&A, basic assistants

### PlaybookOrchestrator

Advanced orchestrator with stages, tools, and two-phase execution:

```mermaid
flowchart TD
    A[Audio] --> B[STT]
    B --> C[Phase 1: Tool Loop]
    C --> D{Tools needed?}
    D -->|Yes| E[Execute Tools]
    E --> C
    D -->|No| F[Phase 2: Response]
    F --> G[TTS]
    G --> H[Audio]
```

- Multiple stages with different prompts/tools
- Two-phase execution (tools silently, then respond)
- Stage transitions based on conversation
- Best for: Complex workflows, support bots, booking systems

---

## The Turn Concept

A **turn** is one exchange: user says something, assistant responds.

```mermaid
sequenceDiagram
    participant U as User
    participant O as Orchestrator
    participant P as Providers

    U->>O: Speaks "What's the weather?"
    O->>P: STT: Transcribe audio
    P-->>O: "What's the weather?"
    O->>P: LLM: Generate response
    P-->>O: "It's sunny and 72°F"
    O->>P: TTS: Synthesize speech
    P-->>O: Audio data
    O->>U: Plays response
```

Within a turn, the orchestrator emits events that can be used for UI updates:
- `transcript` - Speech transcription complete
- `llmChunk` - Streaming LLM response
- `ttsStart` / `ttsComplete` - TTS lifecycle

---

## Streaming vs Non-Streaming

Orchestrators support two modes:

### Non-Streaming
Wait for each step to complete before starting the next:

```
STT (500ms) → LLM (2000ms) → TTS (800ms) = 3300ms total latency
```

### Streaming
Start the next step as soon as data is available:

```mermaid
gantt
    title Streaming Timeline
    dateFormat X
    axisFormat %L

    section Pipeline
    STT           :0, 500
    LLM streaming :400, 2000
    TTS streaming :600, 2200
    Audio playing :700, 2300
```

With streaming, users hear the first audio ~700ms after speaking ends instead of waiting 3300ms.

---

## Orchestrator in the Architecture

```mermaid
graph TB
    subgraph Server["LLMRTCServer"]
        WS[WebSocket]
        RTC[WebRTC]
        SM[SessionManager]
        ORCH[Orchestrator]
    end

    subgraph Providers
        STT[STT Provider]
        LLM[LLM Provider]
        TTS[TTS Provider]
    end

    WS --> SM
    RTC --> SM
    SM --> ORCH
    ORCH --> STT
    ORCH --> LLM
    ORCH --> TTS
```

Each session gets its own orchestrator instance, maintaining isolated conversation state.

---

## Related Documentation

- [Architecture Overview](architecture) - System-wide component diagram
- [Streaming & Latency](streaming-and-latency) - Optimizing response times
- [Playbooks](playbooks) - Multi-stage orchestration
- [Providers](providers) - STT, LLM, TTS provider system
