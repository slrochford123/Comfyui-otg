# Main App Patch (PROD) — Generate dropdown filter + Angles 3D preview

## Changes
1) Generate page workflow dropdown:
   - Hides storyboard workflows (`storyboard/*`)
   - Hides angles workflow (`presets/angles`)
   - Hides internal helper workflows (`internal/*`)
   - Optional allowlist env: `OTG_GENERATE_WORKFLOW_ALLOWLIST` (comma-separated IDs)

2) Angles tab:
   - On image upload, runs internal `internal/angles_3d_preview` workflow against ComfyUI
   - Downloads the `.glb` output and saves it under: `OTG_DATA_DIR/tmp/angles_preview/<deviceId>/<promptId>.glb`
   - Serves it via `/api/file?path=...` (content-type `model/gltf-binary`)
   - NOT saved to Gallery

3) Storyboard tab:
   - Selection chips show only: `1 character`, `2 characters`, ... (no parentheses)

## Install
- Extract this zip into your PROD repo root (overwriting matching paths).
- Run `npm install` (only needed if your project doesn’t already have `@google/model-viewer`).
- Run `npm run build`.
- Restart PROD.

## Optional env
To show only specific workflows in Generate dropdown:

OTG_GENERATE_WORKFLOW_ALLOWLIST=presets/slr_text_to_image,presets/slr_wan_i2v
