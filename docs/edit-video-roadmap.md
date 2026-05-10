# Edit Video Roadmap

Source of truth for the OTG TEST Edit Video tab.

## Current structure

- Bottom-nav tab: **Edit Video** before Settings
- Internal tools:
  - Stitch Video
  - Audio Editing
  - Video Editing

## Checklist

### Phase 1 — Stitch Video base

- [x] Add Edit Video bottom-nav tab
- [x] Add Stitch Video tool
- [x] Support 2-5 video inputs
- [x] Upload video files
- [x] Pick videos from Gallery
- [x] Preview selected videos
- [x] Stitch with FFmpeg
- [x] Preview final video
- [x] Download final video
- [x] Save final video to Gallery
- [x] User verified working

### Phase 2 — Stitch Video controls and polish

- [x] Play Gallery videos before selecting
- [x] Use explicit **Use This Video** button
- [x] Add Move Up / Move Down ordering
- [x] Show clip source, duration, resolution, and size
- [x] Show total duration estimate
- [x] Add output filename field
- [x] Add Stable/Re-encode and Fast/Copy-if-compatible modes
- [x] Improve final result panel
- [x] Save richer stitch metadata to Gallery
- [x] User verified working

### Phase 3A — Audio Editing: uploaded background music

- [x] Enable Audio Editing internal tab
- [x] Select/upload a video
- [x] Choose video from Gallery
- [x] Upload MP3/WAV/M4A/AAC background music
- [x] Preview selected video and music
- [x] Keep/remove original video audio
- [x] Original audio volume control
- [x] Background music volume control
- [x] Loop music if shorter than video
- [x] Mix with FFmpeg
- [x] Preview result
- [x] Download result
- [x] Save result to Gallery with audio metadata
- [x] User verified working

### Phase 3B — Generated music / music library

- [x] Add ACE-Step Turbo as first ComfyUI music workflow target
- [x] Add ACE-Step Base and SFT as optional model choices
- [x] Add prompt/vibe input
- [x] Add duration, BPM, seed, key, and model choice controls
- [x] Generate MP3 through ComfyUI
- [x] Preview generated music
- [x] Use generated music as background music in Audio Editing
- [x] Save generated music to local Music Library
- [x] Allow saved music to be selected in Audio Editing
- [ ] User verification pending

### Phase 3C — Sony Woosh sound effects / Foley

- [ ] Install/verify ComfyUI-Woosh and required model files
- [ ] Add Generate Sound Effects from Video tool
- [ ] Support short clips first, likely up to 8 seconds per Woosh pass
- [ ] Preview generated sound effects
- [ ] Mix generated sound effects with original video audio using FFmpeg
- [ ] Save result to Gallery

### Phase 3D — Dialogue/source separation

- [ ] Choose source-separation model/workflow
- [ ] Extract dialogue/vocals from video
- [ ] Separate music/background noise from dialogue when possible
- [ ] Save extracted dialogue as reusable audio asset
- [ ] Use extracted/custom dialogue in future video workflows

### Phase 4 — Video Editing with ComfyUI

- [ ] Add Video Editing internal tab implementation
- [ ] Add LTX 2.3 Edit Anything workflow integration
- [ ] Support Add / Remove / Replace / Convert Style task types
- [ ] Upload/select video
- [ ] Prompt instruction field
- [ ] Preview edited result
- [ ] Save edited result to Gallery

## Rules

- TEST repo only unless PROD is explicitly requested.
- Keep each phase small and verified before moving on.
- Keep FFmpeg utilities separate from ComfyUI workflows.
- Do not mix ACE-Step, Woosh, or LTX Edit Anything into Phase 3A.
- Gallery metadata should identify edited outputs as edited videos.


## Generate add-on confirmed

- [x] Create Video with Custom Audio workflow added to Generate.
- [x] Uploaded image + uploaded audio routing verified by user.
## Phase 3C â€” Sony Woosh Sound Effects / Foley

Status: patch-prepared, pending TEST verification.

Scope:
- Use selected Audio Editing video as the source.
- Generate synchronized sound effects from video with Sony Woosh VFlow/DVFlow.
- SFX duration follows the selected source video length; current Woosh VFlow/DVFlow models remain capped at 8 seconds by default unless OTG_WOOSH_MAX_SECONDS is raised and supported by the local install.
- Allow manual sound-effect prompt / keywords.
- Mix generated SFX with original video audio using FFmpeg, or replace original audio if requested.
- Preview, download, and save final SFX video to Gallery.

Not included yet:
- Dialogue/source separation.
- LTX 2.3 Edit Anything.
- Long-video chunking/stitching for Woosh outputs.
- Phase 3C update: Sony Woosh SFX duration now auto-matches the selected video length, with the default 8-second model cap preserved for safety.
- [x] Phase 4: LTX 2.3 Edit Anything video editing tab (add/remove/replace/convert style) patch prepared.
