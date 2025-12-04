---
title: Testing & E2E
---

Quick map of the test story; see `e2e/README.md` for full detail.

## Unit & integration
- `npm test` (Vitest) — unit tests across packages.
- `npm run typecheck` — TS project refs.

## E2E (Playwright)
- `npm run test:e2e` — starts backend + frontend, feeds fake media.
- `npm run test:e2e:ui` — interactive runner.
- `npm run test:e2e:providers` — provider-focused suite.
- `npm run test:e2e:local` — local-stack only (Ollama/FasterWhisper/Piper).

Fixtures
- `e2e/fixtures/test-audio.wav`, `test-video.y4m`, `test-image.jpg` (fake mic/cam and vision inputs).

## Required deps
- Node 20+, Playwright Chromium (`npx playwright install chromium`).
- FFmpeg for generating fixtures (if you need to regenerate).

## Where to look
- `e2e/README.md` — architecture, env vars, fake media flags, troubleshooting.
- `Developer.md` — overall dev workflow and architecture notes.
