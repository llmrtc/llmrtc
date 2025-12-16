---
title: Playbook Examples
---

Several examples in this repo demonstrate playbooks + tools end-to-end:

- **Support Bot** ([`examples/support-bot`](https://github.com/llmrtc/llmrtc/tree/main/examples/support-bot)) – multi-stage customer support assistant with auth, triage, resolution, and farewell.
- **Weather Assistant** ([`examples/weather-assistant`](https://github.com/llmrtc/llmrtc/tree/main/examples/weather-assistant)) – single-stage voice assistant focused on weather tools, using `VoicePlaybookOrchestrator`.
- **Playbook tools** ([`examples/playbook-tools`](https://github.com/llmrtc/llmrtc/tree/main/examples/playbook-tools)) – focused example of tools + playbooks without the full voice pipeline.

How to connect the dots:
- Use this section for the conceptual model (stages, transitions, conditions).
- Use **Core SDK → Playbooks** and **Playbooks → Defining Playbooks** for the API surface and types.
- Use **Playbooks → Voice Agents with Playbooks & Tools** and **Backend → Voice Playbook Mode** for wiring into `LLMRTCServer`.
- Use the example READMEs for concrete code (server and client) you can copy.
