# ComfyUI-OTG Rework Checklist

This file is the source of truth for the TEST-site tab rework.

## AI Assistance

- [x] Reduce AI Assistance UI to Describe Picture and Story Helper.
- [x] Describe Picture supports General Image, Background, and Character/Identity description.
- [x] Describe Picture uses the dedicated AI Assistance describe profile.
- [x] Story Helper supports persistent conversations.
- [x] Story Helper supports attached image context.
- [x] Story Helper distinguishes established canon from optional suggestions.
- [x] Story Helper supports strict-canon continuation behavior.
- [x] Story Helper performs a second continuity/canon compliance pass.
- [x] Extend bounded Story Helper conversation history beyond the old 12-message limit.
- [x] Increase AI Assistance context allocation to 16K.
- [x] Remove orphaned legacy Enhance Prompt tab state and handlers.
- [x] Preserve the separate Generate-tab Enhance Prompt feature.
- [x] Preserve shared character-continuity functionality used by Generate.
- [x] Add AI Assistance regression contract coverage.
- [x] TypeScript validation passes.
- [x] Focused regression test passes.
- [x] Production build passes in TEST source.
- [x] TEST port 3001 live acceptance passes.
- [x] AI Assistance rework committed and closed.

## Next Tab

- [ ] Select the next tab only after AI Assistance live acceptance is complete.
