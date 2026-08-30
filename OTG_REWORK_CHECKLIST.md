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

## Generate

- [x] Reduce image modes to Create an Image, Edit an Image, and Create an Animate Image.
- [x] Keep image generation operation-first with no user-facing image model selector.
- [x] Remove Generate image LoRA controls and image LoRA mappings.
- [x] Remove Prompt Guide from Generate.
- [x] Preserve Prompt, Enhance Prompt, microphone, Clear, Undo, Choose a Style, and Portrait/Landscape orientation.
- [x] Preserve Generate, Progress, Preview, and Refresh Preview with Preview last in the Generate flow.
- [x] Keep Generate image layout ordered as Prompt/Enhance Prompt, Style, Orientation, Generate, Progress, Preview.
- [x] Provide meaningfully distinct Short, Medium, and Long Enhance Prompt expansion levels.
- [x] Keep image output at exact 1280x720 landscape or 720x1280 portrait.
- [x] Reduce video modes to Create a Video, Create a Video with a Starter Image, and First Frame + Last Frame Video.
- [x] Route all three Generate video modes through canonical local default ComfyUI LTX 2.5 SafeTensor workflows.
- [x] Remove LtxApi25/cloud API execution nodes from the Generate LTX 2.5 path.
- [x] Do not manually inject a Turbo LoRA into the default LTX 2.5 workflows.
- [x] Preserve the official LTX 2.5 default workflow state with no active workflow LoRA.
- [x] Keep optional Video LoRAs collapsible and fail closed to explicitly verified compatible entries only.
- [x] Do not assume or migrate LTX 2.3 LoRA compatibility into LTX 2.5.
- [x] Keep video duration choices at 5, 10, and 15 seconds.
- [x] Keep Generate LTX 2.5 video at 24 FPS.
- [x] Use the native LTX 2.5 720-class output contract: 1280x704 landscape and 704x1280 portrait.
- [x] Require a starter image for Create a Video with a Starter Image.
- [x] Require distinct first and last frame inputs for First Frame + Last Frame Video.
- [x] Live-prove 5-second landscape LTX 2.5 text-to-video on the RTX 3090.
- [x] Live-prove 5-second landscape LTX 2.5 starter-image video with the correct image binding.
- [x] Live-prove 5-second landscape LTX 2.5 first/last-frame video with both distinct frame bindings.
- [x] Live-prove 10-second portrait LTX 2.5 text-to-video at 704x1280, 24 FPS, with audio.
- [x] Prove a non-empty request title does not override the canonical SaveVideo prefix video/LTX-2.5_text_to_video.
- [x] Prove response videoSettings.outputPrefix matches the actual submitted SaveVideo filename prefix.
- [x] Prove Generate video routes to the RTX 3090 primary backend without activating fallback.
- [x] Keep the three proven LTX 2.5 workflow graphs byte-identical after final route/UI corrections.
- [x] Correct TEST microphone runtime to use the ComfyUI Python environment containing faster-whisper.
- [x] Live-prove Generate microphone capture, transcription, and insertion into the Prompt field through localhost secure-context testing.
- [x] Complete live TEST Generate UI acceptance.
- [x] Focused Generate regression suite passes.
- [x] Replace Generate Enhance Prompt canned/template expansion with local Qwen semantic enhancement; Short, Medium, and Long are context-aware and fail closed without overwriting the original prompt.
- [x] Remove the Create an Image Krea 2 Turbo Darkbrush LoRA/switch dependency; route the sampler directly from the Krea base UNET.
- [x] Keep canonical Krea 2 Turbo Generate image requests pinned to the image lane so generic manifest routing cannot replace the RTX 5060 Ti image backend with the RTX 3090 video lane.
- [x] Live-prove Create an Image after the Krea/routing repairs and confirm Generate video still works.
- [x] TypeScript validation passes.
- [x] Production build passes in TEST source.
- [x] git diff --check passes.
- [x] Generate rework committed and closed.

## Next Tab

- [x] Generate was selected only after AI Assistance live acceptance and closure.
- [x] Select the next tab only after Generate rework is committed and closed.

## Angles Removal / Machine Placeholder

- [x] Select Angles as the next TEST rework target after Generate closure.
- [x] Establish a RED regression contract for complete Angles removal and the temporary Machine placeholder.
- [x] Remove Angles-only user UI, routes, APIs, helpers, scripts, and workflows.
- [x] Replace the Angles navigation entry with a temporary Machine placeholder.
- [x] Redirect the legacy `/angles` route to the Machine placeholder.
- [x] Preserve shared Character, Background, Production, multiview, reference-card, and background-angle-plate functionality.
- [x] Preserve TripoSplat Model Spin and shared character multiview workflows.
- [x] Remove obsolete Angles job kinds only after proving there are no surviving callers.
- [x] Retire legacy `OTG_ANGLES_*` compatibility environment aliases from surviving shared routes only after confirming the active TEST service environment.
- [x] Run focused regression tests, TypeScript validation, production build, and git diff --check.
- [x] Live-accept the TEST Machine placeholder and verify no Angles UI remains.
- [x] Commit and close Angles removal before selecting the next tab.

## Favorites Removal

- [x] Select Favorites removal as the next TEST rework target after Angles closure.
- [x] Audit dedicated Favorites UI, APIs, Gallery favorite metadata, legacy physical-copy storage, Studio compatibility paths, thumbnails, and shared routes.
- [x] Establish a RED regression contract before Favorites source removal.
- [x] Remove the dedicated Favorites navigation tab and Favorites workspace UI/state.
- [x] Remove dedicated `/api/favorites/*`, obsolete `/app/api/favorites/*`, and unused `/api/content/favorite` routes.
- [x] Decouple active shared Thumbnail, Background, and Studio routes from the removed physical Favorites collection.
- [x] Remove obsolete current-content `favorited` state while preserving Gallery metadata.
- [x] Preserve Gallery Heart/favorite metadata and `/api/gallery/favorite` behavior for the upcoming Gallery rework.
- [x] Leave historical Favorites data directories untouched; retain only backward cleanup code where harmless.
- [x] Run focused Favorites, Angles, Generate, TypeScript, production-build, and diff validation.
- [x] Deploy TEST and live-accept that Favorites is gone while Gallery still works.
- [x] Commit and close Favorites removal before Gallery cleanup.

## Gallery Cleanup

- [x] Select Gallery cleanup as the next TEST rework target.
- [x] Keep Gallery Heart/favorite metadata but do not restore a separate Favorites tab or workspace.
- [x] Define Favorites as an independent Gallery filter, not a sort mode.
- [x] Audit Gallery search, media-type filtering, sorting, pagination, view modes, Heart mutation, and stale Gallery UI.
- [x] Establish a RED regression contract for the Gallery Favorites-only filter.
- [x] Add a visible `Favorites` Heart filter that shows only hearted Gallery items when active.
- [x] Make Favorites filtering compose with All/Images/Videos, search, Newest/Oldest/Name, and pagination.
- [x] Reset pagination safely when Gallery filters change.
- [x] Preserve `/api/gallery/favorite` and `meta.favorite` as the Gallery saved-state mechanism.
- [x] Ensure un-hearting an item while Favorites filtering is active removes it from the visible filtered results.
- [x] Complete remaining Gallery cleanup discovered by the dependency/UI audit.
- [x] Remove unreferenced legacy Gallery watcher, filesystem, index, and scan support modules after zero-caller proof.
- [x] Run focused Gallery, Favorites, Angles, Generate, TypeScript, production-build, and diff validation.
- [x] Deploy TEST and live-accept Gallery cleanup.
- [x] Commit and close Gallery cleanup before Characters rework.


## Characters Rework

- [x] Select Characters rework as the next TEST rework target after Gallery closure.
- [x] Audit active Characters UI surfaces, API routes, persistence, image/reference flows, voice flows, and legacy/duplicate components.
- [x] Classify Character source as DELETE / MODIFY / KEEP before implementation.
- [x] Preserve Character Card as the model-facing character reference for generation workflows.
- [x] Keep the clean default character image as selector/thumbnail presentation only, not a generation-reference fallback.
- [x] Preserve existing accepted Character data and media; do not delete user character assets during source cleanup.
- [x] Keep Character Gallery, Create Character, and Background Gallery behavior unchanged.
- [x] Re-audit Asset Gallery, Character voice training, Audio Studio integration points, media storage, jobs, and Linux GPU routing after the corrected requirements.
- [x] Mark the interim browse-only Asset Gallery and top-level Voice Gallery implementation as superseded; do not commit either as the final Characters design.
- [x] Establish a corrected RED regression contract for Asset creation and Voice Characters before new source implementation.
- [x] Replace the browse-only Asset Gallery with Create Asset, Upload Asset, and Asset Library workflows.
- [x] Reuse Ernie Image, Z Image, Krea 2, Boogu, and Mage Flow for Asset generation with prompt and art-style controls.
- [x] Give every Asset a user-defined name.
- [x] Enforce exactly five Asset candidate slots; after five candidates exist, the sixth and every later generation replaces slot five while slots one through four remain.
- [x] Add Asset Save for Later, Clear, Qwen Edit, and Use actions.
- [x] Finalize Use as one canonical Asset image only; do not create multi-angle Asset references.
- [x] Upscale the selected Asset to a dedicated 1080p-class Asset master before final persistence.
- [x] Persist final Assets through the existing owner-scoped `/api/assets` store and preserve the existing Production V2 Asset reference pipeline.
- [x] Replace Voice Gallery with Voice Characters.
- [x] Show only characters with a valid original saved Voice Sample in Voice Characters.
- [x] Preserve the original Voice Sample permanently and make the HQ Voice Model additive and optional.
- [x] Reuse the existing durable Linux IndexTTS2 dataset and Applio training/inference pipeline rather than creating a parallel voice-training backend.
- [x] Strengthen Voice Characters backend regression coverage so adaptive QC and held-out checkpoint selection must exist in the actual Linux workers, not only in policy metadata.
- [x] Replace the fixed-count IndexTTS2 dataset workflow with adaptive generation targeting approximately 8-12 accepted high-quality minutes.
- [x] Condition every synthetic training clip directly from the original saved Character Voice Sample; never recursively clone generated clips.
- [x] Add automated speaker-similarity, transcript/ASR, and audio-quality QC with rejection and regeneration.
- [x] Train the internal HQ model with RVC v2 at 48 kHz using RMVPE and pitch guidance, while keeping those technical controls out of the normal user UI.
- [x] Save useful training checkpoints, run held-out conversion tests, and select the best verified checkpoint instead of assuming the final epoch is best.
- [x] Persist the winning `.pth`, `.index`, source-reference provenance, QC results, training date, and model/version metadata on the Character voice profile.
- [x] Show stage-based Voice Characters progress: Preparing Voice Reference, Generating Training Speech, Validating Dataset, Extracting Voice Features, Training HQ Voice Model, Testing Voice Model, and Finalizing.
- [x] Run focused Characters, Asset, voice-pipeline, Gallery, Favorites, Angles, Generate, TypeScript, production-build, and diff validation.
- [x] Deploy TEST and live-accept the corrected Characters rework.
- [x] Commit and close Characters rework before Production rework.

Audio Studio Voice Sample/HQ Voice Model replacement remains Phase 5 of the voice project and will be implemented during the Edit Video / Audio Studio rework after the Character voice-training foundation is accepted.

## Canonical Remaining Rework Order

The remaining TEST rework order is fixed unless explicitly changed:

1. Characters rework
2. Production rework
3. Edit Video rework
4. Machine implementation
