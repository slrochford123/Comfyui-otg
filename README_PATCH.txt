SLR Studios OTG (TEST) — Storyboard bg-remove + vision-prompt patch

Files included (copy into your TEST repo root, preserving paths):
- app/api/bg-remove/route.ts
- app/api/vision-prompt/route.ts
- app/api/file/route.ts   (new: serves storyboard images for preview; auth required; restricted to OTG_DATA_DIR/uploads/storyboard)
- app/app/components/StoryboardPanel.tsx

What changed:
1) /api/bg-remove
   - Accepts JSON only: { imagePath }
   - Calls BG_REMOVE_URL (multipart to Python service)
   - Saves output PNG to: OTG_DATA_DIR/uploads/storyboard/cleared/
   - Returns JSON: { bgRemovedPath }

2) /api/vision-prompt
   - Forces runtime=nodejs
   - Validates JSON body, restricts imagePath to OTG_DATA_DIR/uploads/storyboard
   - Returns JSON: { descriptor }

3) StoryboardPanel
   - Robust parsing for bg-remove / vision-prompt so UI shows useful errors even if the server returns non-JSON
   - Comfy submission uses: clearedServerPath || serverPath (already implemented)

Note:
- Intended for TEST only (C:\AI\OTG-Test). Do not apply to PROD unless you explicitly promote.
