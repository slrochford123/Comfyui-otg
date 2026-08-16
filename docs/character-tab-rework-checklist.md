# Character Tab Rework Checklist

## Baseline

- TEST only.
- Canonical stable TEST reference: `http://100.75.162.64:3001/app`.
- Canonical current working source before this rework: `/home/shawn-rochford/AI/work/OTG-Test2`.
- Isolated Character rework source: `/home/shawn-rochford/AI/work/OTG-Character-Rework`.
- Current stable `CharactersPanel.tsx` is preserved unchanged and mounted only through the new admin-only Legacy Characters entry.
- Preserved legacy SHA-256: `ad525366b14b0ef070b49670cfa5cf482e8c45eef2d99def44ab834003677588`.

## Phase 1 — Navigation and layout shell

- [x] Preserve current stable Character implementation unchanged.
- [x] Create a new user-facing Character hub from scratch.
- [x] Give Characters a distinct light-blue visual identity.
- [x] Reuse the app's existing `isAdmin` state.
- [x] Expose Legacy Characters only through `Legacy Characters — Admin`.
- [x] Add Character Gallery.
- [x] Add Background Gallery navigation shell.
- [x] Add Asset Gallery navigation shell.
- [x] Add Create Character.
- [x] Add Create Freeform Character.
- [x] Add Upload Character.
- [x] Add Upload Freeform Character.
- [x] Keep all four Character workflows navigation-only for Phase 1.
- [x] Do not wire generation, uploads, saving, background removal, character cards, or voice behavior yet.
- [ ] Manual phone/Android visual approval of Characters landing page.
- [ ] Manual phone/Android visual approval of Character Gallery.
- [ ] Manual phone/Android visual approval of all four Character Gallery entry screens.
- [ ] Manual admin verification of Legacy Characters entry.
- [ ] Manual non-admin verification that Legacy Characters is not visible.

## Phase 2 — Create Character

- [x] Add Character Description input to Create Character.
- [x] Add Character Description input to Create Freeform Character.
- [x] Add the same five-model selector to both creation modes.
- [x] Add Ernie Image.
- [x] Add Z Image.
- [x] Add Krea 2.
- [x] Add Boogu.
- [x] Add Mage Flow.
- [x] Map each UI model to its supplied Turbo workflow filename.
- [x] Keep standard and freeform model availability identical.
- [x] Keep standard Create Character anatomy restrictions separate from Freeform.
- [ ] Runtime visual approval of the model-selection screens.
- [ ] Install/verify every supplied workflow in the active TEST workflow location.
- [ ] Verify required models/nodes on the intended ComfyUI backend.
- [x] Wire selected model + description into the dedicated Character generation API.
- [x] Enable the Create button through the dedicated TEST Character generation route.
- [ ] Reconnect approved image-generation flow.
- [ ] Preserve current full-body completion behavior where required.
- [ ] Require background removal before downstream Character Card creation.
- [ ] Use processed/background-free character image as Character Card workflow source.
- [ ] Preserve processed image as default/profile image.
- [ ] Preserve generated Character Card separately as workflow/reference image.
- [ ] Keep rejected/unused candidates out of the normal Gallery.
- [ ] Validate save contract with Storyboard/Production reference use.

## Later Character workflows

- [ ] Create Freeform Character.
- [ ] Upload Character.
- [ ] Upload Freeform Character.

## Later galleries

- [ ] Background Gallery.
- [ ] Asset Gallery.

## Phase 11 — Character Identity + Voice Completion

- [x] Continue only on TEST port 3003 / `/home/shawn-rochford/AI/work/OTG-Character-Rework`.
- [x] After accepting the Character Card, collect only Character Name and compact Appearance.
- [x] Persist the processed/background-free single-character image as the default/profile image.
- [x] Persist the accepted Character Card separately as the workflow/reference master sheet.
- [x] Persist a compact `globalPromptIdentityBlock` for later MiniMax H3 scene prompting.
- [x] Add Qwen3-TTS voice creation.
- [x] Add CosyVoice voice creation.
- [x] Add LTX Voice creation with LTX accent/dialect selection only.
- [x] Keep language/accent controls hidden for Qwen3-TTS and CosyVoice.
- [x] Add first-class Upload Voice Sample / Reference Voice.
- [x] Normalize uploaded reference media and allow it to complete the character without TTS generation.
- [x] Support generated and uploaded voices through the same canonical saved voice contract.
- [x] Add optional deep/neutral/high pitch controls plus custom voice FX tuning.
- [x] Preserve optional LTX Remove Background Sound / Effects and Enhance Voice processing.
- [x] Require a verified real local audio path before saving the canonical character voice.
- [x] Persist voice source metadata as `generated` or `uploaded_reference`.
- [x] Add saved Character Gallery cards with image, name, appearance, and Play Voice.
- [x] Keep the compact identity block ready for later MiniMax H3 character-name injection.
- [ ] Runtime verify Qwen3-TTS voice creation on TEST 3003.
- [ ] Runtime verify CosyVoice voice creation on TEST 3003.
- [ ] Runtime verify LTX Voice creation and optional cleanup on TEST 3003.
- [ ] Runtime verify uploaded voice reference completion on TEST 3003.
- [ ] Runtime verify deep/high voice FX on generated and uploaded voices.
- [ ] Runtime verify Character Gallery Play Voice after refresh.
- [ ] Runtime verify saved H3 identity block and canonical reference audio in the character JSON.
- [x] PROD untouched.

## Phase 3 — Style Presets and Fixed Output

- [x] Add shared style preset selector to Create Character.
- [x] Add shared style preset selector to Create Freeform Character.
- [x] Add Cartoon preset.
- [x] Add Anime preset.
- [x] Add 3D Pixar preset.
- [x] Add Unreal Engine preset.
- [x] Add Photorealistic preset.
- [x] Add Cinematic preset.
- [x] Keep the same style catalog across standard and freeform creation.
- [x] Fix output to portrait 1080 x 1920.
- [x] Document 9:16 aspect ratio in the UI.
- [x] Document random-seed behavior in the UI.
- [x] Keep generation disabled until backend routing is connected.
- [ ] Runtime visual approval of style preset screens.
- [x] Inject selected style preset into server-side prompt construction.
- [x] Force exact portrait 1080 x 1920 final output in the TEST generation route.
- [x] Force a fresh server-side random seed in the TEST generation route.
- [x] Wire the Create button to ComfyUI and return temporary candidates.

## Phase 4 — ComfyUI Connection

- [x] Install the five supplied Turbo workflow JSON files under `workflows/characters/create`.
- [x] Add dedicated `POST /api/characters/create-image`.
- [x] Keep the global `/api/comfy` pixel guard unchanged.
- [x] Route Ernie Image, Z Image, Krea 2, and Boogu to the configured image backend first.
- [x] Preflight-fallback those four models to the local 3090 before submission when needed.
- [x] Route Mage Flow to the local 3090 because the 5060 Ti lacks its model/CLIP/VAE.
- [x] Never fail over after a ComfyUI `/prompt` submission attempt.
- [x] Force final output to portrait 1080 x 1920.
- [x] Use 1088 x 1920 internally for Mage Flow and scale decoded output to exact 1080 x 1920.
- [x] Generate a fresh random seed server-side.
- [x] Inject the selected art style server-side.
- [x] Keep standard and freeform anatomy contracts distinct server-side.
- [x] Use `PreviewImage` for temporary Character candidates instead of normal `SaveImage`.
- [x] Return up to five temporary candidates in the Character UI.
- [ ] Runtime-test Ernie Image end-to-end.
- [ ] Runtime-test Z Image end-to-end.
- [ ] Runtime-test Krea 2 end-to-end.
- [ ] Runtime-test Boogu end-to-end.
- [ ] Runtime-test Mage Flow end-to-end.
- [ ] Verify every returned candidate is exactly 1080 x 1920.
- [ ] Verify standard mode enforces the standard anatomy contract.
- [ ] Verify Freeform does not force two-arm/two-leg anatomy.
- [ ] Connect Continue to Character Card.
- [ ] Connect Save for Later to the dedicated deferred Character Gallery.
- [ ] Add cleanup for rejected temporary ComfyUI candidates.


## Phase 5b — Candidate Expanded Preview

- [x] Make the generated candidate image itself clickable.
- [x] Open the candidate in a full-screen expanded viewer.
- [x] Preserve the entire portrait with `object-contain` instead of cropping.
- [x] Add explicit Close control.
- [x] Close when the user taps the dark backdrop.
- [x] Keep Modify, Select, Save for Later, and Clear separate from image expansion.
- [x] Disable native image dragging in the expanded viewer.
- [x] Portal the expanded viewer above the app content stacking context and all normal fixed/sticky chrome.
- [x] Keep the Close control above the viewer with pointer events, a 48px minimum touch target, and mobile safe-area offsets.
- [x] Close on Escape, preserve backdrop close outside the image, and stop image taps from closing the viewer.
- [ ] Runtime verification on TEST port 3003 of tap-to-expand and close behavior.

<!-- OTG_CHARACTER_CANDIDATE_ACTIONS_PHASE5D -->
## Phase 5 — Character Candidate Actions

- [x] Add Modify, Select, Save for Later, and Clear to generated candidates.
- [x] Require explicit Select before a candidate becomes the Character Card source.
- [x] Clear removes the current candidate without auto-selecting another.
- [x] Save for Later persists outside the normal Gallery.
- [x] Saved for Later storage uses the Character device-scoped ownership contract.
- [x] Add separate Saved for Later Character Gallery.
- [x] Allow saved candidates to return to Standard or Freeform Create.
- [x] Candidate image click/tap opens the expanded full-screen viewer.
- [x] Modify captures an edit instruction.
- [ ] Connect Modify to a verified edit-image ComfyUI workflow.
- [ ] Connect selected candidate to actual Character Card generation.
- [ ] Add delete management to Saved for Later Gallery.
- [ ] Runtime verify persistence after refresh.
- [ ] Runtime verify reuse.
- [ ] Runtime verify expanded viewer on Android.


<!-- OTG_CHARACTER_GALLERY_LAYOUT_PHASE5E -->
## Phase 5e — Character Gallery Card Layout

- [x] Create Character is top-left.
- [x] Create Freeform Character is directly below Create Character.
- [x] Upload Character is top-right.
- [x] Upload Freeform Character is directly below Upload Character.
- [x] Saved for Later is below all four primary Character actions.
- [x] Saved for Later spans the full Character Gallery width on desktop.

<!-- OTG_CHARACTER_SAVED_FOR_LATER_DEVICE_SESSION_PHASE5F -->
## Phase 5f — Saved for Later Session Repair

- [x] Remove the incompatible standalone `getOwnerContext` requirement from Saved for Later.
- [x] Reuse the Character UI `x-otg-device-id` ownership contract.
- [x] Bridge the Character device id into a same-origin cookie so saved `<img>` requests resolve to the same owner bucket.
- [x] Keep Saved for Later assets outside the normal Gallery.
- [ ] Runtime verify Save for Later no longer reports `Session invalid`.

<!-- OTG_CHARACTER_SOFT_GENERATION_PROMPT_PHASE6 -->
## Phase 6 — Character Generation Prompt Softening

- [x] Remove rigid `two arms / two legs` language from Standard Create generation.
- [x] Remove `hands and feet fully visible` and `unobstructed anatomy` prompt pressure.
- [x] Keep the useful composition target: one full-body standing character, natural neutral pose, complete subject in frame, simple clean background, no crop.
- [x] Remove the same hard anatomy wording from the visible Character Rules panel.
- [x] Keep fixed 1080 × 1920 output, selected model/workflow routing, style presets, and fresh random seed behavior unchanged.
- [x] Prefer post-generation validation/retry over prompt over-constraint.
- [ ] Runtime compare output quality across Ernie, Z Image, Krea 2, Boogu, and Mage Flow.

<!-- OTG_CHARACTER_SOFT_GENERATION_PROMPT_PHASE6B -->
## Phase 6b — Character Generation Prompt Softening

- [x] Replace the audited hard Standard Create prompt blocks with concise natural framing guidance.
- [x] Remove `both hands and both feet visible`.
- [x] Remove `no body parts outside the frame`.
- [x] Remove `exactly natural standard humanoid proportions`.
- [x] Remove `missing feet` from the Standard negative prompt.
- [x] Replace extreme `highest point to lowest point` framing language.
- [x] Replace turnaround-quality wording with clean character-reference guidance.
- [x] Update visible Character Rules to match the softer backend contract.
- [x] Preserve fixed 1080 × 1920 output, model/workflow routing, styles, and random seed behavior.
- [ ] Runtime compare output quality across the five Character image models.

<!-- OTG_CHARACTER_NO_EXTRA_PROMPT_RULES_PHASE6C -->
## Phase 6c — Remove Extra Character Prompt Rules

- [x] Remove Standard Character anatomy/framing prompt rules.
- [x] Remove Freeform-specific prompt rules.
- [x] Remove extra negative prompt rules.
- [x] Send only the user Character Description plus selected Art Style prompt.
- [x] Remove the visible Character Rules panel.
- [x] Preserve fixed 1080 × 1920 output.
- [x] Preserve model/workflow routing.
- [x] Preserve style preset selection.
- [x] Preserve fresh random seed behavior.
- [ ] Runtime compare generation quality across all five Character image models.

<!-- OTG_CHARACTER_STYLE_PRESETS_NO_SILHOUETTE_PHASE6D -->
## Phase 6d — Character Style Preset Wording

- [x] Remove the word `silhouette` from Character style preset prompt text.
- [x] Preserve all six style presets and existing model/workflow behavior.

<!-- OTG_CHARACTER_MAGE_5060_PRIMARY_PHASE7 -->
## Phase 7 — Mage Flow 5060 Ti Primary Routing

- [x] Route Mage Flow through Character `image-primary` first (RTX 5060 Ti).
- [x] Keep Mage Flow node/model preflight before submission.
- [x] Keep local RTX 3090 as pre-submit fallback if 5060 Ti preflight fails.
- [x] Never fail over after `/prompt` submission begins.
- [ ] Runtime generation must confirm `backend: image-primary`.

<!-- OTG_CHARACTER_PROMPT_ENHANCE_PHASE8 -->
## Phase 8 — Character Prompt Enhance

- [x] Add `Enhance Prompt` beneath Character Description for Create Character and Create Freeform Character.
- [x] Use the dedicated `/api/characters/enhance-description` service without changing the general enhancer.
- [x] Send only the current Character Description; do not send an enhancement level or workflow metadata.
- [x] Keep selected Character Art Style out of enhancement and apply it only during generation.
- [x] Replace the same editable Character Description field with the enhanced result.
- [x] Keep Generate Character as a separate explicit action.
- [x] Do not add new hard anatomy/framing rules.
- [ ] Runtime verify enhancement quality on TEST port 3003.

<!-- OTG_CHARACTER_DESCRIPTION_ENHANCE_PHASE8B -->
## Phase 8b — Character-Only Description Enhancement

- [x] Stop using the general cinematic/image prompt enhancer for Character Description.
- [x] Add `/api/characters/enhance-description` dedicated to character-specific descriptive enrichment.
- [x] Enhance appearance, face/hair/fur, eyes, surface qualities, clothing, materials, colors, accessories, textures, and distinctive features.
- [x] Do not pass or add Art Style; generation injects the selected Art Style separately.
- [x] Do not add camera, lighting, environment, background, composition, framing, pose, crop, anatomy rules, or quality tags.
- [x] Preserve the user's core character identity and explicit details.
- [x] Keep enhanced text editable in the same Character Description field.
- [ ] Runtime verify enhancement quality on TEST port 3003.

<!-- OTG_CHARACTER_DESCRIPTION_ENHANCE_PHASE8C -->
## Phase 8c — Concrete Character Description Enhancement

- [x] Reject generic category-list enhancement output.
- [x] Require concrete visual choices consistent with the user's concept.
- [x] Add a second AI refinement pass when the first result is too short or generic.
- [x] Remove the fake deterministic fallback that replaced prompts with generic boilerplate.
- [x] Preserve the original Character Description when the AI provider fails.
- [x] Keep Art Style completely separate from Character Description enhancement.
- [x] Allow a dedicated stronger model through `OLLAMA_CHARACTER_DESCRIPTION_MODEL`.
- [ ] Runtime verify with short prompts such as `a teenage female mutant tree person`.

<!-- OTG_CHARACTER_DESCRIPTION_PROVIDER_PHASE8D -->
## Phase 8d — Real Character Description Provider

- [x] Isolate Character Description enhancement from the general heuristic prompt-enhancer model settings.
- [x] Default Character Description enhancement to `qwen2.5:3b`.
- [x] Keep a dedicated `OLLAMA_CHARACTER_DESCRIPTION_MODEL` override.
- [x] Keep a dedicated `OLLAMA_CHARACTER_DESCRIPTION_URL` override.
- [x] Default Character model keep-alive to 5 minutes.
- [x] Use only `OLLAMA_CHARACTER_DESCRIPTION_TIMEOUT_MS`, defaulting to 45 seconds and capped at 60 seconds.
- [x] Use restrained Character sampling and prompt for 5-8 concrete additions in one 60-90 word paragraph.
- [x] Preserve the requested body plan and prohibit invented powers, transformations, lore, story behavior, art direction, and scene direction.
- [x] Preserve original description on provider failure.
- [x] Install/start Ollama on the TEST host and pull `qwen2.5:3b`.
- [ ] Runtime verify Character Enhance Prompt on port 3003.

<!-- OTG_CHARACTER_STANDARD_FULL_BODY_RULE_PHASE9C -->
## Phase 9c — Standard Character Full-Body Generation Rule

Standard Create Character:

- [x] Exactly one character.
- [x] Full-body neutral standing pose.
- [x] Entire figure head-to-toe visible.
- [x] Both arms fully visible.
- [x] Both legs fully visible.
- [x] Exactly two arms / two legs.
- [x] No cropped head/hands/legs/feet.
- [x] No bust / half-body / close-up / portrait crop.
- [x] No chibi / super-deformed framing.
- [x] Long-shot full-figure framing.
- [x] Camera far enough back.
- [x] Stronger negative crop/anatomy exclusions.
- [x] Standard only.
- [x] Freeform unrestricted.
- [x] Prompt Enhance unaffected.
- [x] Art Style remains separate.
- [ ] Runtime verification on TEST port 3003 pending.

<!-- OTG_ADMIN_FULL_GALLERY_3003_PHASE10B -->
## Admin Full Gallery on TEST 3003

- [x] Existing multi-source Admin Gallery implementation audited
- [x] Admin Settings → Full Gallery entry active
- [x] Admin-only server authorization active
- [x] RTX 3090 local ComfyUI output source active
- [ ] RTX 5060 Ti remote ComfyUI output source active
- [x] All Sources combined view active
- [x] Images supported
- [x] Videos supported
- [x] Video Range/seek support active
- [x] Recursive listing active
- [x] Newest-first sorting active
- [x] Source labels/badges active
- [x] Source health/error isolation active
- [x] Same Standard Gallery controls active
- [x] Same control labels/order/confirmations active
- [x] Expanded image/video viewer active
- [x] Mobile Close behavior active
- [x] Normal user Gallery remains unchanged
- [x] Character candidates remain isolated
- [x] Tests pass
- [x] TypeScript passes
- [ ] Runtime verification on 3003 pending
- [x] PROD untouched
- [x] Port 3001 untouched

<!-- OTG_STANDARD_GALLERY_3003_PARITY_PHASE10 -->
## Standard Gallery parity dependency — Phase 10

- [x] Confirm stable 3001 runs `/home/shawn-rochford/AI/deploy/otg-test/releases/character-full-body-primary-attempt-gate-v6-20260803T115936Z`, with `/home/shawn-rochford/AI/work/OTG-Test2` as `OTG_WORK_REPO` and the shared TEST data-root contract.
- [x] Preserve the stable 3001 `GalleryWorkspace` and its main-app integration in the 3003 Character worktree.
- [x] Preserve the Gallery list, scoped file, thumbnail, ComfyUI sync, owner/device, sorting, refresh, and force-pull contracts.
- [x] Preserve the exact Gallery controls, labels, order, disabled states, confirmations, errors, and responsive expanded viewer.
- [x] Keep Character temporary candidates and Saved for Later storage outside the Standard Gallery.
- [x] Keep `CharacterHubPanel`, Mage Flow, and admin-only Legacy Characters routing intact.
- [ ] Runtime verification on TEST port 3003 pending.

- [x] TEST Phase 9 - Television Anime Art Styles: top-level Anime reveals a secondary Default + 25 television-anime preset dropdown; Default preserves the existing Anime prompt, while alternate selections inject a separate descriptive visual-style prompt for both Create Character and Create Freeform Character.

- [x] Phase 10: Character Create mobile persistence - client request is persisted before submit, server uses an idempotent request registry, Comfy prompt IDs can be recovered after a lost Android Chrome response, polling resumes on visibility/pageshow, and completed candidates are restored. <!-- OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10 -->

- [x] TEST Phase 11 - 3D Animation Art Styles: the existing Pixar 3D display label is generalized to 3D Animation while retaining its stable internal ID; selecting it reveals Default + 25 curated 3D-animation presets, each injected as a separate descriptive style prompt and persisted through the Phase 10 mobile durable-generation job contract.
- [x] TEST Phase 12 - Character Card execution graph optimized: preserved the fixed eight-view master-sheet contract while sharing repeated Qwen model/CLIP/VAE/LoRA preprocessing, using 0.32 MP full-body and 0.20 MP close-up generation tiers, and using the Multiple-Angles <sks> trigger.
- [ ] TEST Phase 12 runtime gate - verify a fresh-seed warm Character Card completes in <= 180 seconds (target 120-150 seconds) before declaring the performance SLO closed.

<!-- OTG_TEST_LTX_VOICE_5060_FAILOVER_AUDIT_20260811 -->
## TEST LTX Voice RTX 5060 Ti Failover

Scope and safety gate:

- [x] TEST-only audit completed on 2026-08-11; PROD was not modified or deployed.
- [x] Qwen3 and CosyVoice routing were left unchanged.
- [x] Character UI was left unchanged.
- [x] Automatic LTX failover prerequisite satisfied: the shared RTX 5060 Ti GPU lock is enforced by every audited application-controlled 8188 submission entrypoint and by the 8191 fallback lifecycle.
- [x] The implementation uses the atomic shared lease as its exclusivity authority; `/queue` is only a secondary safeguard.

Verified fallback proof supplied for this task:

- [x] One real RTX 5060 Ti LTX 2.3 split-aux generation passed.
- [x] Diffusion: `ltx-2.3-22b-distilled-1.1-Q3_K_S.gguf`.
- [x] Text encoder: `gemma_3_12B_it_fp4_mixed.safetensors`.
- [x] Standalone text projection: `ltx-2.3_text_projection_bf16.safetensors`.
- [x] Standalone Audio VAE: `LTX23_audio_vae_bf16.safetensors`.
- [x] Real output: 5.05-second FLAC in 28.41 seconds.
- [x] Peak VRAM: 15,039 MiB; minimum available system RAM approximately 11.7 GiB; peak swap approximately 647 MiB.
- [x] `NRestarts=0`, no CUDA OOM, no Linux OOM, and a real output was written.
- [x] Exclusive RTX 5060 Ti GPU ownership is required while fallback LTX is active.
- [x] The fallback must not load `ltx-2.3-22b-dev-nvfp4.safetensors` or the old distilled LoRA.

Current audited primary call chain and runtime:

- [x] Character UI queues `POST /api/characters/voice-pipeline` with `action=create_voice_sample` and `provider=ltx` or `unnatural_ltx`.
- [x] `lib/jobs/voicePipelineJobs.ts` persists the durable job; `POST /api/worker/jobs/claim` leases it by provider.
- [x] `otg-character-ltx-voice-worker-3003.service` is the actual Character-rework TEST 3003 primary service (`active/running`, `NRestarts=0` at audit time).
- [x] Primary worker entrypoint configured by the active 3003 systemd unit: `/home/shawn-rochford/AI/work/OTG-Character-Rework/scripts/linux/otg-character-ltx-voice-worker.py`.
- [x] Primary endpoint: `http://100.75.162.64:8188` (RTX 3090).
- [x] Primary workflow: active worktree `comfy_workflows/presets/LTX Voice Sample.json`.
- [x] Primary worker currently uses the process-local `flock` file `/home/shawn-rochford/AI/runtime/test/voice-gpu.lock`, waits for the 3090 queue, releases cached models, submits `/prompt`, waits for history, downloads node 384 audio, uploads it, then completes/fails the durable job.
- [x] Current 3003 primary readiness fault recorded: the active worker's strict model preflight rejects the installed nested LoRA name (`LTX-2.x/Acceleration/ltx-2.3-22b-distilled-lora-384-1.1.safetensors`) because it expects the bare filename, so it leaves LTX jobs queued without submitting.
- [x] A separate legacy `otg-character-ltx-voice-worker.service` is still enabled and auto-restarting because its `/home/shawn-rochford/AI/deploy/otg-test/current/scripts/linux/otg-character-ltx-voice-worker.py` entrypoint is missing; it is not the active 3003 primary service and reached `NRestarts=35,684` in the final read-only audit.

Current audited fallback and locking boundary:

- [x] Fallback endpoint is `http://100.98.212.116:8191`.
- [x] Fallback service identifier is `otg-character-ltx-audio-5060-3003.service` and it is hosted on the RTX 5060 Ti machine, not the web/3090 host.
- [x] Normal RTX 5060 Ti ComfyUI is reachable on `http://100.98.212.116:8188` (also referenced by current TEST runtime through `http://192.168.1.113:8188`).
- [x] Read-only runtime preflight on 2026-08-11 found both 3090/8188 and 5060/8188 healthy with empty queues; 5060/8191 was not listening, consistent with start-on-demand rather than permanently warm operation.
- [x] `lib/workers/resourceLocks.ts` already declares `gpu:linux-5060ti`, but no current Comfy `/prompt` submission path acquires, heartbeats, or releases it.
- [x] Worker lifecycle commands exist, but the repository currently contains only the Windows WorkerManager execution agent; no deployed/readable Linux lifecycle agent was found that can start/observe `otg-character-ltx-audio-5060-3003.service` on the remote host.
- [x] The verified Q3 split-aux API workflow artifact was not found in this repository, TEST runtime storage, patch backups, or locally readable workflow locations; do not reconstruct it from an older full-checkpoint workflow.

Implementation status:

- [x] Explicit LTX primary/fallback backend descriptor implemented and covered by targeted state-machine tests.
- [x] Deterministic pre-submit selection implemented for `primary-unreachable-or-not-ready`, `primary-busy`, and `primary-resource-locked`; no post-submit failure can select fallback.
- [x] Explicit `submission_unknown` / primary-submission-unknown handling implemented and tested to forbid fallback after an ambiguous primary POST.
- [x] Shared atomic SQLite `gpu:linux-5060ti` lease implemented with an immediate write transaction, primary-key exclusion, fencing token, authenticated heartbeat/release, and race-safe stale replacement.
- [x] All audited application-controlled Comfy prompt submission entrypoints use the shared lease conditionally whenever their resolved endpoint is RTX 5060 Ti port 8188; the LTX fallback holds the same lease through output persistence and durable-job finalization.
- [x] Remote 5060 lifecycle source integration and authenticated TEST control-plane access are complete. The corrected root-owned agent is installed on `slr`, remains active/enabled with `NRestarts=0`, and completed authenticated status, demand-start, readiness, and release operations while the managed 8191 service remained disabled at boot.
- [x] Compatible backend routing metadata persistence implemented (`preferredGpu`, `actualGpu`, `backend`, `fallbackReason`, `backendEndpoint`, `backendService`, `submissionId`/`promptId`, `submissionState`); legacy records without these fields still read.
- [x] Exact proven split-aux workflow recovered byte-for-byte from `slr:/mnt/otg_fast/voice-fallback/ltx-5060/workflows/test/LTX-2.3_T2A_5060_Q3_K_S_SPLIT_AUX_API_TEST.json`; SHA256 `7bfd9d22d18cf6acd04fa334d041f3210a34ed8e541f323033a7321fce946dba`.
- [x] Static fallback workflow contract passes with all four split-aux model references, zero `ltx-2.3-22b-dev-nvfp4.safetensors` references, and zero LoRA nodes.
- [x] Targeted unit/contract tests pass for atomicity, stale recovery, ownership, mutual exclusion, routing, ambiguous submission, duplicate prevention, cleanup order, metadata, lifecycle control, workflow model contract, and legacy reads.
- [ ] Live application failover test.
- [ ] Qwen3 RTX 5060 Ti proof.
- [ ] CosyVoice RTX 5060 Ti proof.
- [ ] PROD deployment.

Required architectural work before failover can be enabled:

- [x] Replace the JSON resource-lock store with atomic cross-process SQLite transactions and expose bearer-authenticated acquire/heartbeat/release operations for `gpu:linux-5060ti`.
- [x] Make every audited active application prompt path lock-aware whenever it resolves to RTX 5060 Ti port 8188, including the 19 originally identified image routes plus animate-preview, LTX edit, music, woosh, production animation/audio/video, and `lib/comfyVoices.ts`.
- [x] Audit non-route submission code: the Windows LTX worker targets its separate legacy Windows/3090 endpoint; `scripts/run-comfy-capability-matrix.mjs` now requires the TEST WorkerManager URL/token, acquires the mapped physical cluster GPU lease before `/prompt`, and retains that lease after an ambiguous submission.
- [x] Hold application 8188 leases from before `/prompt` until Comfy history reports terminal; hold the fallback lease from before 8191 lifecycle start through output collection, upload/persistence, final job mutation, and failure cleanup.
- [x] Install the exact already-proven Q3 split-aux API workflow artifact in the TEST worktree and assert required split-aux models, fixed patch/output nodes, zero LoRA nodes, and absence of the full NVFP4 checkpoint.

Static implementation verification — 2026-08-11:

- [x] Red phase recorded before implementation: 22 targeted failures (missing atomic/failover modules, 19 uncovered submission routes, missing lifecycle agent, and missing exact split-aux workflow).
- [x] Atomic lease/failover infrastructure: 13/13 tests pass, including eight-process simultaneous acquisition and two-process stale-successor races.
- [x] Relevant voice-pipeline/resource-lock/lifecycle regression: 157/157 tests pass across six focused files.
- [x] Static 8188/lifecycle/ordering/workflow coverage: 31/31 assertions pass.
- [x] `python3 -m py_compile` passes for the LTX worker and TEST Linux lifecycle agent.
- [x] `npx tsc --noEmit --pretty false` passes under repository Node 20.
- [x] Remote lifecycle bridge is installed on `slr`; the corrected installed agent SHA256 is `b6a63aa009795ff16424f7def6ebab92ca795c46a2c93ab17a234d5a22873641` and authenticated TEST worker-control completed the real lifecycle validation.
- [x] The staged `slr-ltx-5060-agent` completed a real authenticated dry-run lifecycle round trip for capability `ltx-audio-5060`: queued → claimed → completed with `finalState=inactive`; it did not start 8191 and the temporary agent process was stopped afterward.
- [x] Exact `comfy_workflows/internal/characters/ltx_voice_5060_split_aux_api.json` artifact is present and byte-identical to the proven `slr` source.
- [ ] Live failover matrix remains intentionally incomplete; no live GPU generation was run in this phase.

Remaining-blocker closure attempt — 2026-08-11 (historical; installation blocker subsequently resolved):

- [x] Proven workflow source and destination both hash to `7bfd9d22d18cf6acd04fa334d041f3210a34ed8e541f323033a7321fce946dba`.
- [x] Character-Rework development TEST worker-control is enabled without affecting production and still requires the existing bearer token.
- [x] `otg-character-ltx-audio-5060-3003.service` remains `inactive`, `disabled`, `NRestarts=0`; port 8191 is not listening and no generation was submitted.
- [x] `otg-ltx-5060-worker-agent.service` was subsequently installed root-owned with the existing authenticated control path; no unauthenticated or unprivileged systemd control was introduced.
- [x] Obsolete `otg-character-ltx-voice-worker.service` on `shawn` is `inactive`, `dead`, and `disabled`, with `NRestarts=0` after cleanup.
- [x] Focused regression is fully green: 7 test files, 189/189 tests.
- [x] `npx tsc --noEmit --pretty false` exits successfully under Node 20.

Installed lifecycle validation — 2026-08-12 (first attempt; readiness defect corrected and superseded below):

- [x] Installed `otg-ltx-5060-worker-agent.service` baseline: `active/running`, enabled, `NRestarts=0`.
- [x] Managed `otg-character-ltx-audio-5060-3003.service` baseline: `inactive/dead`, disabled, `NRestarts=0`, port 8191 closed.
- [x] Authenticated real status command: queued, claimed by `slr-ltx-5060-agent`, and completed with `finalState=inactive`.
- [ ] Demand-start lifecycle did not complete: 8191 started, `/system_stats` and `/object_info` both returned HTTP 200, and the service stayed at `NRestarts=0`, but the lifecycle command expired because the installed agent checked `127.0.0.1:8191` while the managed service listens only on `100.98.212.116:8191`.
- [x] Failure cleanup completed through an authenticated release command claimed by `slr-ltx-5060-agent`: 8191 stopped, the port closed, service remained disabled with `NRestarts=0`, and GPU returned exactly to the 300 MiB baseline (`0%` utilization; only the normal 8188 process at 290 MiB).
- [x] Agent source corrected to default `OTG_LTX_5060_HEALTH_URL` to `http://100.98.212.116:8191/system_stats`; corrected payload SHA256 `b6a63aa009795ff16424f7def6ebab92ca795c46a2c93ab17a234d5a22873641` is staged at `/home/slrochford123/otg-ltx-5060-agent-install/otg-worker-agent.py`.
- [x] Root-owned installed agent was replaced/restarted with the corrected managed-endpoint probe; see the successful repeat below.
- [x] This first-attempt lifecycle blocker is resolved. No audio prompt or generation was submitted.

Corrected installed lifecycle validation — 2026-08-12:

- [x] Installed agent artifact SHA256 is `b6a63aa009795ff16424f7def6ebab92ca795c46a2c93ab17a234d5a22873641`; its default health probe targets the actual managed endpoint at `100.98.212.116:8191`.
- [x] Baseline state: `otg-ltx-5060-worker-agent.service` was `active/running`, enabled, `NRestarts=0`; `otg-character-ltx-audio-5060-3003.service` was `inactive/dead`, disabled, `NRestarts=0`; port 8191 was closed.
- [x] Authenticated status command `wlc_msphteut_b59f6be79f6797b1` progressed queued → claimed by `slr-ltx-5060-agent` → completed with `finalState=inactive`.
- [x] Authenticated ensure-running command `wlc_msphtmub_60586d92b9ff66f4` progressed queued → claimed → completed successfully (not expired); 8191 became `active/running`, stayed at `NRestarts=0`, and remained disabled at boot.
- [x] Readiness contract passed: `/system_stats` HTTP 200, `/object_info` HTTP 200, all 17 workflow-required node types present, zero NVFP4 workflow references, and zero LoRA nodes.
- [x] Authenticated release command `wlc_msphuaj6_6dfd06e2ab05aed7` progressed queued → claimed → completed; 8191 became inactive, port 8191 closed, and the managed service remained disabled with `NRestarts=0`.
- [x] GPU returned exactly to the approximately 300 MiB idle baseline at 0% utilization; the lifecycle agent remained `active/running`, enabled, and at `NRestarts=0`.
- [x] Focused static/lifecycle/voice regression passes: 7 files, 189/189 tests; Python lifecycle/worker compilation passes; `npx tsc --noEmit --pretty false` exits 0 under Node 20.
- [x] Lifecycle and static prerequisites are safe to proceed into the live failover matrix.
- [ ] Live failover generation matrix remains intentionally unexecuted; no audio or image generation was submitted during lifecycle validation.

Previous live TEST safety stop — 2026-08-11 (pre-implementation snapshot; superseded by the static status above):

- [ ] BLOCKED before generation submission: the requested failover implementation is not present in this worktree or the running TEST build. No `primary-submission-unknown` state/hook, LTX backend routing metadata, 8191 fallback route, or lock-aware 8188 submission path was found.
- [ ] BLOCKED shared-GPU exclusion: `lib/workers/resourceLocks.ts` still uses a non-atomic JSON read/modify/write store, and `gpu:linux-5060ti` is declared only in the catalog/character-completion metadata; normal 8188 submission entrypoints do not acquire and hold it through output collection.
- [ ] BLOCKED fallback lifecycle: `otg-character-ltx-audio-5060-3003.service` is not installed on this host/control plane and 5060 port 8191 was not listening. The existing 3003 LTX worker remains a 3090-only worker using `/home/shawn-rochford/AI/runtime/test/voice-gpu.lock`.
- [ ] Live matrix cases 1-9 were not run. Per the duplicate/race stop condition, zero controlled LTX or image generations were submitted and no live-verification item is marked complete.
- [ ] Final regression and TypeScript verification were not run after the safety stop; implementation-level verification must precede live generation testing.
