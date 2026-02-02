# Decisions (Why we do things this way)

This file captures short, durable architectural decisions.

## 2026-01-06 — Changelog is mandatory
- We maintain a repo-root `CHANGELOG.md`.
- Every feature, fix, refactor, dependency change, or folder move updates it.

## 2026-01-06 — Central output root
- ComfyUI outputs are synchronized into a deterministic per-device folder.
- The root is configured via env (prefer `OTG_DEVICE_OUTPUT_ROOT`, fallback to `OTG_DATA_DIR/device_galleries`, fallback to `./data/device_galleries`).

## 2026-01-06 — Storybook is the UI harness for Phase A
- Storybook (via `@storybook/react-vite (with Vite builder)`) lives in this repo and is the source of truth for UI parity.
- We must be able to run `npm run storybook` and see the same CSS and component behavior as production.

## 2026-01-08 — Vitest is the unit test runner (opt-in)
- Vitest is installed for lightweight unit/component tests.
- Tests live under `/tests` and are not required for `next build`.
- Running tests is explicit (`npm run test`, `npm run test:run`, `npm run test:ui`).