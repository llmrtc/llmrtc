---
title: Release Process
---

Suggested flow
- Bump versions across packages using workspace versioning.
- Update CHANGELOG with notable changes and migrations.
- Tag the repo (`vX.Y.Z`).
- Publish packages to npm (core, backend, web-client, providers) in dependency order.
- Build and deploy docs (`npm run --workspace docs build`), then host on your chosen platform.

Document platform-specific steps here once finalized.
