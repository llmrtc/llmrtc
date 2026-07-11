---
"@llmrtc/llmrtc-provider-openai": patch
---

Fix streaming TTS failing with "response.body?.getReader is not a function"
when the OpenAI SDK returns a Node Readable body (Node < 18 or apps loading
the SDK's Node shims). The provider now handles web ReadableStream bodies,
async-iterable Node stream bodies, and buffered fallback. Previously the
error was caught upstream and every turn silently fell back to
non-streaming TTS, adding seconds of latency.
