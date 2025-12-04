---
title: Contributing
---

We welcome issues and PRs.

- Fork and create a feature branch.
- Run `npm install` at the repo root (monorepo workspaces).
- Check code: `npm run lint`, `npm run typecheck`, `npm test`.
- For docs changes, run `npm install --workspace docs` then `npm run --workspace docs start`.
- Follow conventional commit style if possible.

Useful references
- `Developer.md` for architecture and dev workflow.
- `e2e/README.md` for Playwright end-to-end tests and fake media setup.

Open an issue for large proposals before implementing.
