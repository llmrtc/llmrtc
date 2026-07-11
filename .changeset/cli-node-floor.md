---
"@llmrtc/llmrtc-backend": patch
---

The CLI now refuses to start on Node versions below 20 with a clear
message (override with LLMRTC_SKIP_NODE_CHECK=1). Unsupported runtimes
previously failed in confusing ways at runtime instead of at startup.
