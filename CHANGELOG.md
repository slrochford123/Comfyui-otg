# 2026-07-19 - TEST Wan/LTX Video LoRA support

- Added a curated, source-controlled LTX 2.3 Video LoRA catalog, live dual-backend inventory API with a 45-second cache, catalog-only compatibility mapping, and an installed/compatible Generate Video selector with a two-LoRA maximum and explicit trigger-word action.
- Added immutable `LoraLoaderModelOnly` injection contracts for all three LTX SafeTensor and all six Wan GGUF/SafeTensor Generate Video workflows. Required LightX2V, distilled, Licon, IC-LORA, SageAttention, chunk-feed-forward, sampling, preview, and duration wiring remains unchanged.
- Added selected-LoRA-aware RTX 3090/RTX 5060 Ti routing, fail-closed validation, precise 400/409 errors, and sanitized job/request metadata. No selected LoRA is dropped during fallback and ambiguous submissions remain no-retry events.
- Creator metadata gaps remain `metadata_pending`; Camera Controls retains its non-commercial warning, and internal acceleration/quality LoRAs are not exposed.
- Validation passed 279 Vitest tests, TypeScript, and a clean Node 20.20.2 standalone build. Three RTX 3090 LTX generations were visually inspected successfully (T2V, I2V, and a two-LoRA hard-cut stack). Wan physical testing remains blocked by the absence of an administrator-curated selectable Wan style LoRA; TEST activation remains blocked by interactive sudo authorization, so the prior TEST release stays active and PROD remains untouched.

# 2026-07-18 - TEST production-readiness packaging

- Added deterministic Wan/LTX/FFLF UI contracts, a synchronous Generate duplicate-click guard, standalone TEST release packaging, guarded PROD promotion/rollback scripts, promotion audits, and the PROD checklist.
- Source validation passed 247 Vitest tests, TypeScript, and a clean Next.js 15.5.18 standalone build under Node 20.20.2. The candidate release packaged successfully, but activation remains blocked because restarting `otg-test.service` requires interactive sudo authorization; the prior TEST release remains active and PROD was not modified.

# 2026-07-18 - TEST dual-GPU capability routing

- Added deterministic RTX 3090/RTX 5060 Ti capability manifests, verified-only fallback routing, live compatibility checks, duplicate-submission protection, and a cold/warm workflow evidence matrix. Verified all six Wan 2.2 modes on the 3090 and six image workflows on the 5060 Ti; no deployment or service restart performed.

# CHANGELOG

## [Unreleased]

- Fix Studio preview: use device gallery newest file -> user_previews/latest; add /api/preview/file; keep preview visible while generating.
- Fix Auth/Login persistence: add a native dependency preflight for better-sqlite3 Node ABI mismatches, use rolling persistent auth cookies, and revoke the active DB session on manual logout.

### Fixed
- Output watcher now copies ComfyUI renders into OTG device galleries (OTG_DEVICE_OUTPUT_ROOT / OTG_DATA_DIR/device_galleries), enabling preview and gallery updates.
- /api/comfy now auto-starts the output watcher for the active device.
- /api/debug-env now reports device gallery status.
- Added a "Clear Pipeline" button in Settings to reset a stuck "already running" generation state (409).

## 2026-01-14
### Fixed
- Resolved Storybook/Vitest dependency conflicts by pinning Storybook packages.
- Excluded Storybook and Vitest files from Next.js typechecking.
- Added DB shim (lib/auth/db.ts) to unblock admin route builds.
- Added npm scripts for storybook and vitest.

### Phase D
- Infrastructure stabilization before SSE-driven Queue + History.

## 2026-01-14

### Changed
- Rebranded UI from ComfyUI OTG to SLR Studios OTG (header/title text, splash/login, install banner).
- Replaced global background with new SLR banner on all pages.
- Updated PWA manifest names/colors and regenerated favicon + app icons from SLR square logo.
