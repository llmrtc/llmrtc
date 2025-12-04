---
title: Playbooks
---

Playbooks let you script multi-stage conversations with per-stage tools and transitions.

- Define stages (e.g., `greeting`, `collect_info`, `confirm`, `fulfill`).
- Each stage can declare tools, prompts, and exit conditions.
- Transitions can be triggered by tool results, keywords, intent, or an explicit LLM decision.
- Server emits `stage-change` events (`from`, `to`, `reason`) in voice/playbook mode.

Use cases
- Booking flows, support triage, sales qualification, multi-turn workflows.

Tips
- Keep stage prompts short and focused; reset or trim history between stages to control drift.
- Emit analytics on `stage-change` to measure drop-off.
- Use two-phase turns (tool loop + final reply) to keep answers concise while still letting the agent call tools.

See also:
- [Playbooks Overview](/playbooks/overview)
- [Voice Agents with Playbooks & Tools](/playbooks/voice-agents-with-tools)
