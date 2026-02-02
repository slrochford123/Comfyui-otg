# CHANGELOG

## [Unreleased]

- Fix Studio preview: use device gallery newest file -> user_previews/latest; add /api/preview/file; keep preview visible while generating.

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
