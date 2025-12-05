---
title: Architecture Overview
---

LLMRTC is a modular SDK for building real-time voice and text AI applications. This page explains the overall architecture and how components interact.

---

## Package Structure

```mermaid
graph TB
    subgraph Packages
        CORE["@metered/llmrtc-core"]
        BACKEND["@metered/llmrtc-backend"]
        WEBCLIENT["@metered/llmrtc-web-client"]
        PROVIDERS["Provider Packages"]
    end

    BACKEND --> CORE
    WEBCLIENT --> CORE
    PROVIDERS --> CORE

    subgraph "Provider Packages"
        OAI["@metered/llmrtc-provider-openai"]
        ANTH["@metered/llmrtc-provider-anthropic"]
        GEM["@metered/llmrtc-provider-gemini"]
        ELEV["@metered/llmrtc-provider-elevenlabs"]
    end
```

| Package | Purpose |
|---------|---------|
| `@metered/llmrtc-core` | Types, orchestrators, tools, protocol, hooks |
| `@metered/llmrtc-backend` | Server, WebRTC, VAD, session management |
| `@metered/llmrtc-web-client` | Browser client, audio capture, events |
| `@metered/llmrtc-provider-*` | LLM, STT, TTS provider implementations |

---

## High-Level Data Flow

```mermaid
graph LR
    subgraph Browser
        MIC[Microphone] --> WC[Web Client]
        WC --> SPK[Speaker]
    end

    subgraph Server
        SRV[LLMRTCServer]
        VAD[VAD]
        ORCH[Orchestrator]
    end

    subgraph Providers
        STT[STT Provider]
        LLM[LLM Provider]
        TTS[TTS Provider]
    end

    WC <-->|WebRTC/WebSocket| SRV
    SRV --> VAD
    VAD --> ORCH
    ORCH --> STT
    ORCH --> LLM
    ORCH --> TTS
    TTS --> ORCH
    ORCH --> SRV
```

**Flow:**
1. User speaks into microphone
2. Audio streams to server via WebRTC
3. VAD detects speech boundaries
4. STT transcribes audio to text
5. LLM generates response
6. TTS synthesizes speech
7. Audio streams back to browser via WebRTC

---

## Conversation Turn Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant C as Web Client
    participant S as Server
    participant VAD
    participant STT
    participant LLM
    participant TTS

    U->>C: Speaks
    C->>S: Audio (WebRTC)
    S->>VAD: Audio frames
    Note over VAD: Detect speech start
    S-->>C: speech-start event

    VAD->>S: Speech end detected
    S-->>C: speech-end event

    S->>STT: Transcribe audio
    STT-->>S: Text
    S-->>C: transcript event

    S->>LLM: Generate response
    loop Streaming
        LLM-->>S: Chunk
        S-->>C: llm-chunk event
    end

    S->>TTS: Synthesize speech
    loop Streaming
        TTS-->>S: Audio chunk
        S->>C: Audio (WebRTC)
    end
    S-->>C: tts-complete event

    C->>U: Plays audio
```

---

## Server Components

```mermaid
graph TB
    subgraph LLMRTCServer
        WS[WebSocket Handler]
        WRTC[WebRTC Handler]
        SM[SessionManager]

        WS --> SM
        WRTC --> SM
    end

    subgraph Session
        AP[AudioProcessor]
        VADP[VAD]
        CO[ConversationOrchestrator]
        VPO[VoicePlaybookOrchestrator]
    end

    SM --> AP
    AP --> VADP
    VADP --> CO
    VADP --> VPO
```

| Component | Responsibility |
|-----------|----------------|
| `WebSocket Handler` | Signaling, control messages |
| `WebRTC Handler` | Audio/video streaming |
| `SessionManager` | Session lifecycle, reconnection |
| `AudioProcessor` | Audio buffering, format conversion |
| `VAD` | Voice activity detection (Silero v5) |
| `ConversationOrchestrator` | Simple STT → LLM → TTS pipeline |
| `VoicePlaybookOrchestrator` | Two-phase execution with tools |

---

## Orchestrator Types

### ConversationOrchestrator

Simple pipeline for single-prompt assistants:

```mermaid
flowchart LR
    Audio --> STT --> LLM --> TTS --> Audio2[Audio Out]
```

### PlaybookOrchestrator

Two-phase execution with stages and tools:

```mermaid
flowchart TD
    USER[User Message] --> P1

    subgraph Phase1["Phase 1 (Silent)"]
        P1[LLM + Tools] --> TOOLS{Tool calls?}
        TOOLS -->|Yes| EXEC[Execute Tools]
        EXEC --> P1
        TOOLS -->|No| P2
    end

    subgraph Phase2["Phase 2 (Streaming)"]
        P2[Final Response] --> TTS
    end

    TTS --> OUT[Audio to User]
```

### VoicePlaybookOrchestrator

Wraps PlaybookOrchestrator with STT/TTS for voice:

```mermaid
flowchart LR
    Audio --> STT --> PO[PlaybookOrchestrator] --> TTS --> Audio2[Audio Out]
```

---

## Transport Layer

LLMRTC uses WebRTC for low-latency audio and WebSocket for signaling:

```mermaid
graph TB
    subgraph Client
        WS_C[WebSocket]
        DC[DataChannel]
        AT[Audio Track]
    end

    subgraph Server
        WS_S[WebSocket]
        DC_S[DataChannel]
        AT_S[Audio Track]
    end

    WS_C <-->|Signaling, Events| WS_S
    DC <-->|Tool calls, Transcripts| DC_S
    AT <-->|Bidirectional Audio| AT_S
```

| Transport | Purpose |
|-----------|---------|
| WebSocket | Signaling (SDP, ICE), control messages |
| DataChannel | Low-latency JSON messages (transcripts, tool events) |
| Audio Track | Bidirectional audio streaming |

---

## Provider Architecture

Providers implement standardized interfaces:

```mermaid
classDiagram
    class LLMProvider {
        +name: string
        +complete(request): Promise~LLMResult~
        +stream(request): AsyncIterable~LLMChunk~
    }

    class STTProvider {
        +name: string
        +transcribe(audio, config): Promise~STTResult~
    }

    class TTSProvider {
        +name: string
        +speak(text, config): Promise~TTSResult~
        +speakStream(text, config): AsyncIterable~Buffer~
    }

    class VisionProvider {
        +name: string
        +describe(request): Promise~VisionResult~
    }
```

### Provider Selection

```mermaid
flowchart TD
    START[Request] --> CHECK{Provider<br/>configured?}
    CHECK -->|Explicit| USE[Use configured provider]
    CHECK -->|Auto| ENV{Check env vars}
    ENV -->|OPENAI_API_KEY| OAI[OpenAI]
    ENV -->|ANTHROPIC_API_KEY| ANTH[Anthropic]
    ENV -->|GOOGLE_API_KEY| GEM[Gemini]
    ENV -->|ELEVENLABS_API_KEY| ELEV[ElevenLabs]
```

---

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: WebSocket connect
    Created --> Active: ready message
    Active --> Processing: speech detected
    Processing --> Active: turn complete
    Active --> Reconnecting: connection lost
    Reconnecting --> Active: reconnect success
    Reconnecting --> Expired: max retries
    Active --> Expired: TTL exceeded
    Expired --> [*]
```

| State | Description |
|-------|-------------|
| Created | Session initialized, awaiting WebRTC setup |
| Active | Connected and ready for conversation |
| Processing | Currently handling a conversation turn |
| Reconnecting | Connection lost, attempting recovery |
| Expired | Session TTL exceeded or max reconnect attempts |

---

## Playbook State Machine

```mermaid
stateDiagram-v2
    [*] --> Greeting: initialStage

    Greeting --> Auth: keyword "login"
    Greeting --> Triage: keyword "help"

    Auth --> Triage: tool "verify_user" success
    Auth --> Greeting: tool "verify_user" failure

    Triage --> Resolution: llm_decision
    Triage --> Farewell: keyword "goodbye"

    Resolution --> Farewell: tool "resolve_issue" success
    Resolution --> Triage: tool "escalate"

    Farewell --> [*]: conversation ends
```

---

## Streaming TTS Architecture

```mermaid
sequenceDiagram
    participant LLM
    participant CHUNK as Sentence Chunker
    participant TTS
    participant AUDIO as Audio Buffer
    participant CLIENT as Client

    LLM->>CHUNK: "Hello! How can I..."
    CHUNK->>TTS: "Hello!"
    Note over TTS: Start synthesizing
    TTS->>AUDIO: Audio chunk 1
    AUDIO->>CLIENT: Stream audio
    LLM->>CHUNK: "...help you today?"
    CHUNK->>TTS: "How can I help you today?"
    TTS->>AUDIO: Audio chunk 2
    AUDIO->>CLIENT: Stream audio
```

**Key:** Sentence chunking enables TTS to start before LLM finishes, reducing time-to-first-audio.

---

## Related

- [Backend Configuration](../backend/configuration) - Server setup
- [Web Client Overview](../web-client/overview) - Client setup
- [Playbooks Overview](../playbooks/overview) - Playbook concepts
- [Providers Overview](../providers/overview) - Provider system
