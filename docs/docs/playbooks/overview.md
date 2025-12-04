---
title: Playbooks Overview
---

Playbooks are structured conversation flows made of **stages** and **transitions**. They sit on top of an LLM + tools and let you build agents that move through named phases instead of a single amorphous chat.

Use a playbook when:
- You have a clear multi-step flow (greeting → auth → triage → resolution → farewell).
- Different stages need different tools, prompts, or models.
- You want observability into which stage a user is in and how they move.

Core ideas
- **Stage**: a named state with its own system prompt, tools, and LLM config.
- **Transition**: a rule that moves you from one stage to another based on conditions (keywords, tool results, intent, timeouts, or an explicit LLM decision).
- **Two-phase turns**: Phase 1 runs the tool loop; Phase 2 generates the final user-facing response.

Playbooks are implemented in `@metered/llmrtc-core` via the `Playbook` type, `PlaybookEngine`, and `PlaybookOrchestrator`. For voice agents, `VoicePlaybookOrchestrator` in `@metered/llmrtc-backend` adds STT/TTS and streams events to the client.

Next:
- [Defining playbooks](defining-playbooks)
- [Text agents with PlaybookOrchestrator](text-agents)
- [Voice agents with playbooks + tools](voice-agents-with-tools)
