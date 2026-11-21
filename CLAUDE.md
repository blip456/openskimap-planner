# Working agreements for agents (branch `iphone-pwa`)

The plan is `docs/pwa-plan.md`. Follow it; record any deviation in `docs/agents/decisions.md` with the reason.

## Before you start any task
1. Read `docs/agents/lessons.md` (mistakes made before and how to avoid them). Apply every lesson.
2. Read `docs/agents/progress.md` (what is done, handover notes from the previous agent).

## Environment
- Use Node 24: `export PATH=/opt/node24/bin:$PATH` before any `node`/`npm` command (Node 22 is the default in the shell).
- tippecanoe, GDAL (`gdal_contour`) and the `pmtiles` CLI are installed. Real data for the Oberstdorf resort is in `build/` after `npm run build` (not in git).
- Chromium is preinstalled. E2E tests use the pinned `@playwright/test` devDependency (`npm run test:e2e`). Only for plain `.cjs` scripts using the global Playwright under Node 24, set `NODE_PATH=/opt/node22/lib/node_modules`. Do not run `playwright install`. Pass `--trace off` to Playwright test runs.
- No `gh` CLI. Do not push; the orchestrator commits and pushes.

## Rules
- Keep the old `planner/` working until phase 4 says it can be removed.
- Every change comes with tests where it makes sense (`node:test` for `packages/core`, Vitest or Playwright for the app). Run the full test suite before you hand over: `npm test`.
- When a test fails: find the root cause, fix it, and add a lesson to `docs/agents/lessons.md` (what went wrong, why, how to prevent it). If the fix is a check that can be automated (lint rule, test, script), add it.
- No model names or AI attribution in code, comments or docs.
- Write user-facing text and docs in plain, simple English (the owner is a non-native speaker).
- At the end of your task, append a handover entry to `docs/agents/progress.md`: what you did, how to verify it, open issues, and questions for the owner (only if truly needed).
