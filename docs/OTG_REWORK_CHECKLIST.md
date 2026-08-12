# OTG Rework Checklist

## App Theme System

### Completed
- Added global theme tokens for primary, surfaces, borders, text, status, focus, and progress colors.
- Added preset theme palettes: Purple, Blue, Yellow, Red, and Green.
- Added Custom theme color support with generated light/dark token palettes.
- Added global Light/Dark mode state, top-right app toggle, and Settings > Themes controls.
- Theme, color mode, and custom color preferences persist locally with migration from the old app-shell theme names.

### Remaining
- Continue replacing deeply embedded feature-specific hardcoded Tailwind colors as those screens are touched.
- Add visual browser QA snapshots for each preset in both light and dark mode before promoting beyond TEST.

## Character Tab / Voice Lab

### Completed
- Added OTG worker contract foundation for the intended deployment model: Linux hosts the app/control plane and the main Windows PC claims heavy generation/training/editing jobs. Generic worker claim/complete/fail routes now exist under `/api/worker/jobs/*`, and artifact upload exists under `/api/worker/artifacts/upload`.
- Added `lib/jobs/workerJobContract.ts` as the central worker-only action registry. Current registered Windows adapters cover Character Voice dataset generation, Voice FX, base voice design, Applio training, trained voice preview, Animate Me preview queueing, and Production Audio Studio actions.
- Added `OTG_CONTROL_PLANE_ONLY=1` guard for Linux hosts so local worker ticks leave heavy Voice Lab jobs queued for the Windows worker instead of executing them server-side.
- Added `scripts/windows/otg-worker.ps1` and `scripts/windows/otg-worker.py` as a Windows worker coordinator that dispatches the existing IndexTTS2 dataset, Applio training, and Applio inference worker adapters from the main PC. The coordinator also registers an optional Animate preview adapter and skips it with a clear log until `scripts/windows/animate-preview-worker.py` is installed.
- Animate Me now queues `character_animation_preview` / `animate_preview` jobs and returns HTTP 202 instead of running ComfyUI, Seed-VC, and ffmpeg inside the request. This avoids Cloudflare 524s and keeps Linux in control-plane-only mode.
- Created `otg-local-execution-audit.txt` to track Linux-local execution points that still need conversion to worker-dispatched jobs. Current findings include Angles Blender/Hunyuan, direct local ComfyUI calls, local ffmpeg/python paths, and other generation routes that must not remain Linux-local in production.
- Character builder draft state now persists locally and to the TEST server draft store, including current builder page, selected style, typed fields, Voice Lab page, active job state, and profile state. Drafts clear only through Start Over/reset or save completion.
- Character builder progression now persists locked-page state. After moving forward, completed Character Builder and Voice Lab pages are restored as locked after tab changes, app reloads, or browser/app close; earlier pages can only be changed by Start Over.
- Character builder hydration is now server-first. The Characters tab waits for `/api/characters/builder-draft` before rendering a default page, falls back to local cache only when no server draft exists, saves page/sub-page navigation immediately, and flushes a best-effort draft on `visibilitychange` / `pagehide` for mobile app switching.
- Character builder draft migration now upgrades older draft payloads to schema v2, restores `activeBuilderPage` / `lastBuilderStep`, restores `voiceLabPage` / `lastVoiceLabPage`, and infers Voice Lab sub-page from active dataset/model jobs or persisted voice sample fields.
- Voice Lab dataset preparation and voice model training jobs now expose Stop and Resume controls. Stop marks the durable job as user-stopped; Resume requeues the same job so resumable dataset/training artifact logic can continue from durable state.
- Voice Lab / Voice Effects now has a compact Base Voice section, user-friendly Simple FX controls, collapsed Advanced FX preset categories, relevant-only advanced control groups, and a view-only effect chain. Preview is a non-rendering hook until the Windows audio worker is connected; Apply still queues the existing Voice FX worker path and includes structured simple/preset/chain settings.
- Production Storyboard saved-character picker now displays the saved character portrait/full-body image while sending the saved character card image into the workflow slot when a card path is available.
- Character visual/card workflow is active in TEST repo.
- Qwen3-TTS VoiceDesign foundation exists.
- Qwen bridge script exists: `scripts/qwen3_voice_design_preview.py`.
- Qwen direct smoke test passed with `generate_voice_design()`.
- Qwen language normalization fixed: `en` maps to `english`.
- `/api/characters/voice-preview` is wired to the Qwen bridge.
- CharactersPanel sends selected Qwen candidate preview payload.
- Qwen preview button is enabled in source.
- Mobile/Tailscale slowness was diagnosed as mostly Next dev-mode overhead.
- Gallery load was reduced from `per=5000` to `per=80`.
- Automatic Gallery sync was disabled during startup/tab switching.

### In Progress
- Character Voice Lab rework into a full voice pipeline.
- Add Voice FX / tuning layer after Qwen or Chatterbox voice generation.

### Next
- Wire Character Voice Lab UI to `/api/characters/voice-fx`.
- Add audio controls:
  - pitch shift
  - speed
  - gain
  - high-pass / low-pass
  - echo/reverb starter presets
  - normalize
- Add Chatterbox as a second voice generator.
- Compare:
  - Qwen raw
  - Qwen tuned
  - Chatterbox raw
  - Chatterbox tuned
- Lock tuned reference voice for Index.
- Generate Index voice pack:
  - neutral
  - happy
  - sad
  - angry
  - yelling
  - scared
  - whisper
  - surprised

## ComfyUI Workflow Presets

### Completed
- Fixed `comfy_workflows/presets/Create a Video.json` after ComfyUI node 112 `SamplerCustomAdvanced` failed with `NoneType` latent input. The first sampler now receives the LTX video/audio latent and scheduler output directly instead of through rgthree `Any Switch` wrappers that can resolve to `None` in this preset.

### Verification
- JSON parse and node-reference validation passed for `Create a Video.json`.

## Future Sound Studio / Speaker Diarization

Goal:
Detect who speaks when in LTX-generated clips.

Pipeline:
Video -> FFmpeg audio extraction -> diarization -> speaker timeline -> assign speakers to saved characters -> Index dubbing -> reattach audio to video.

Required UI:
- Detect Speakers button
- Expected speaker count selector
- Speaker timeline
- Character assignment dropdown per speaker
- Segment split/merge/edit controls
- Run Index Dub
- Preview final dubbed video

Fallback:
Manual sliders for start/end speaker assignment if diarization is wrong.

Preferred tools:
- pyannote.audio first
- WhisperX optional for transcript/word timing
- FFmpeg for extraction/recombination

## 2026-05-25 - Qwen3 Base Voice Sample Completion

Completed:
- Real Qwen3 base voice sample adapter verified.
- Generated real WAV with mock:false, adapter:qwen3, provider:qwen3.
- ffprobe verified 24 kHz mono PCM WAV.
- Added dedicated voice sample serving route.
- Updated future Qwen sampleUrl format to /api/characters/voice-sample/file.
- Tests passed: 12 files / 42 tests.
- Build passed.

Next:
- Add Cosy/CosyVoice base sample adapter.
- Then Voice FX adapter.
- Then dataset generation and Applio training integration.

## 2026-05-25 - Cosy/CosyVoice Base Voice Sample Adapter Contract

Completed:
- Added feature-flagged Cosy/CosyVoice worker adapter for `create_voice_sample` jobs with provider `cosy`.
- Cosy disabled path preserves the existing no-op mock lifecycle.
- Cosy enabled path validates `COSYVOICE_ROOT`, `COSYVOICE_PYTHON`, `COSYVOICE_SITE_PACKAGES`, and `COSYVOICE_BRIDGE`.
- Cosy result contract matches the Qwen sample contract and uses `/api/characters/voice-sample/file`.
- No existing Cosy bridge was found in this repo, so real local proof requires supplying `COSYVOICE_BRIDGE`.

Next:
- Manually prove Cosy/CosyVoice generation once a real bridge and local paths are available.
- Then add the Voice FX adapter.
- Then dataset generation and Applio training integration.

## 2026-05-25 - Cosy/CosyVoice Bridge Entrypoint

Completed:
- Added `scripts/cosy_voice_sample_bridge.py`.
- Bridge accepts `--params-json`, `--stdout-log`, and `--stderr-log`.
- Bridge writes structured JSON logs and exits nonzero on dependency/API/model/config failure.
- Normal mode does not create dummy WAV files.
- `COSYVOICE_BRIDGE_TEST_MODE=success` exists only for explicit bridge smoke tests and writes a small deterministic WAV.
- Bridge now uses the proven CosyVoice3 API: `AutoModel(model_dir=...)` and `model.inference_instruct2(text, instruction, prompt_wav, stream=False)`.
- Proven local values: `COSYVOICE_ROOT=C:\AI\Voices\cosyvoice`, `COSYVOICE_PYTHON=C:\Users\SLRoc\miniconda3\envs\voices-cosy\python.exe`, `COSYVOICE_MODEL_ID=Fun-CosyVoice3-0.5B`, prompt WAV `C:\AI\Voices\cosyvoice\asset\zero_shot_prompt.wav`.
- Real worker proof completed: job `cvp_1779737697433_a3b47ad60998` returned `mock:false`, `adapter:cosy`, `provider:cosy`, `exitCode:0`, and `outputBytes:1117520`.
- `ffprobe` verified the output as 24 kHz mono WAV, and `/api/characters/voice-sample/file` served it with HTTP 200.

Next:
- Then add the Voice FX adapter.

## 2026-05-25 - Voice FX Adapter Contract

Completed:
- Added feature-flagged real Voice FX worker adapter for `apply_voice_fx` jobs.
- Real FX is enabled with `OTG_ENABLE_REAL_VOICE_FX=1`.
- Adapter uses ffmpeg via `VOICE_FX_FFMPEG`, `FFMPEG_PATH`, or `ffmpeg` on `PATH`.
- Output is saved as `fx.wav` beside voice sample jobs under `data/characters/<ownerKey>/voice-samples/<characterId>/<jobId>/`.
- `/api/characters/voice-sample/file` now serves both `sample.wav` and `fx.wav`, and rejects unknown file names.
- Tests cover mock fallback, missing input, missing ffmpeg, successful test-mode result contract, and route file validation.
- Completed Voice FX jobs now persist tuned sample metadata onto `characterVoiceProfile` without overwriting the base sample.
- Use Raw approves the base sample; Use Tuned approves the tuned sample and keeps the base sample for provenance.
- Training queue actions now require `characterVoiceProfile.approvedSampleUrl` and carry approved source metadata into the queued job input.
- `generate_training_dataset` now creates a durable no-op voice pack under `data/characters/<ownerKey>/training-datasets/<characterId>/<jobId>/` with `manifest.json` plus 200 copied WAV clips in `clips/`; clips are marked `ready` and served through `/api/characters/training-dataset/file`.
- Training dataset generation now normalizes the approved source audio with ffmpeg before clip creation. Supported source formats are WAV, MP3, M4A, FLAC, and OGG; the canonical source is written to `source/source.wav` as mono `pcm_s16le` at `APPLIO_SAMPLE_RATE` or 40000 Hz by default, and the 200 mock clips are copied from that canonical source.
- `generate_training_dataset` now defaults to real 200-utterance voice-pack generation through the selected Qwen3 or Cosy worker adapter. The copy-based pack is retained only as an explicit dev fallback with `OTG_ALLOW_MOCK_VOICE_PACK=1`.
- Real pack manifests record `generationMode:"real"`, the provider, unique utterance text per clip, generated clip count, started/completed timestamps, source provenance, and canonical audio settings. A failed or partial pack is not marked `voice_pack_ready`.
- Real pack generation is now resumable and durable across worker runs. The manifest is updated after each clip, clip status is tracked as `pending`, `generating`, `ready`, or `failed`, ready clips are skipped on resume, missing/zero-byte ready files are regenerated, and each clip has a default two-attempt retry policy.
- The worker processes real packs in chunks (`VOICE_PACK_CHUNK_SIZE`, default 10) and reports `Generated X / 200 clips` while leaving incomplete jobs in `running` state for the next worker run. This is a crash-tolerant short-term fix for the observed Cosy native crash around clip 132; a persistent/batch Cosy bridge is still the better long-term fix.
- Real packs are validated before readiness. A pack is not marked `voice_pack_ready` unless all requested clips are ready, all files exist with bytes, and the generated WAV hashes are not all identical.
- Cosy real voice-pack generation now uses `scripts/index_tts2_clone_pack_bridge.py` for dataset chunks. The bridge loads CosyVoice once per chunk, uses `source/source.wav` as the prompt/reference WAV, generates multiple raw clip WAVs in one Python process, and lets the TypeScript worker normalize and commit each successful clip independently.
- `COSYVOICE_BATCH_BRIDGE` can override the batch bridge path; otherwise the worker uses `index_tts2_clone_pack_bridge.py` beside `COSYVOICE_BRIDGE`.
- `start_applio_training` now creates a durable no-op artifact under `data/characters/<ownerKey>/applio-models/<characterId>/<jobId>/training-artifact.json` from the dataset manifest, with expected model/index/config paths and `model.status:not_trained`.
- Completed `start_applio_training` jobs now persist the no-op Applio artifact reference onto `characterVoiceProfile.voiceModelArtifactId` and `characterVoiceProfile.voiceModelArtifacts` while preserving approved base/tuned sample provenance.
- Real Applio training is now wired behind `OTG_ENABLE_REAL_APPLIO_TRAINING=1`. When enabled, `start_applio_training` rejects mock/copy packs, requires a real `voice_pack_ready` manifest with 200 ready WAV clips, prepares a non-destructive Applio dataset copy under `APPLIO_DATASETS_ROOT`, runs the configured Applio `core.py` CLI, and refuses success unless deterministic `.pth` and `.index` files are produced under `data/characters/<ownerKey>/applio-models/<characterId>/<jobId>/`.
- Real Applio artifacts use `adapter:"applio_real_training"`, `mock:false`, `status:"trained"`, `model.status:"trained"`, and include stdout/stderr/command log paths. If config is missing or training fails, the job fails clearly and does not create fake trained outputs.
- Completed real Applio training jobs now persist trained model metadata back into `characterVoiceProfile`. The profile records `status:"trained"`, `trainingAdapter:"applio_real_training"`, `trainingMock:false`, `sourceTrainingJobId`, `voiceModelArtifactId`, `voiceModelArtifacts[]`, `trainingArtifactPath`, `trainingArtifactUrl`, `datasetManifestPath`, `datasetManifestUrl`, `modelPath`, and `indexPath`.
- Voice Lab Applio training now has quality presets: Fast (`25` epochs, save every `5`, estimated `20-40 minutes`), Normal (`100` epochs, save every `10`, estimated `45-90 minutes`, default), and Quality (`200` epochs, save every `10`, estimated `90-180+ minutes`). `start_applio_training` jobs carry `trainingQualityPreset`, `epochs`, `saveEveryEpoch`, and `estimatedDurationLabel`; real Applio prefers those job values over `APPLIO_EPOCHS` / `APPLIO_SAVE_EVERY_EPOCH` env fallbacks.
- Real Applio training jobs now write durable timer/stage metadata while running and on completion/failure: `trainingStartedAt`, `currentStage`, `stageStartedAt`, elapsed labels, epoch progress when parseable, `trainingCompletedAt` or `trainingFailedAt`, and total duration. Completed trained artifacts persist the preset and duration fields back into `characterVoiceProfile.voiceModelArtifacts[]`.
- Character save/update paths validate trained Applio artifacts before writing profile JSON. A profile marked trained or containing a real Applio artifact is rejected unless both `modelPath` and `indexPath` exist as non-empty files.
- The Voice Lab now reconciles completed `start_applio_training` jobs from the durable voice-pipeline job store on reload, so a model trained by the local worker while the UI is not actively polling can still hydrate into the active builder profile and persist through the existing `update_voice_profile` route when the character exists.
- Voice Lab now has a separate `test_trained_voice` worker action and Test Trained Voice button. This path requires a persisted real Applio artifact (`mock:false`, `adapter:"applio_real_training"`) plus non-empty `.pth` and `.index` files, uses the approved local source sample only as inference input, and refuses raw/tuned sample fallback as the playback result.
- Trained voice inference runs through the installed Applio `core.py infer` CLI with `cwd=APPLIO_ROOT`, `APPLIO_PYTHON`, and `APPLIO_INFER_SCRIPT` when provided. For this local Applio install, set `APPLIO_INFER_SCRIPT=C:/AI/Voices/Applio/core.py`; the old `infer.py` path is not present. Defaults: `APPLIO_INFER_F0_METHOD=rmvpe`, `APPLIO_INFER_INDEX_RATE=0.75`, `APPLIO_INFER_PITCH=0`, `APPLIO_INFER_PROTECT=0.33`, `APPLIO_INFER_OUTPUT_FORMAT=WAV`, `APPLIO_INFER_TIMEOUT_MS=600000`.
- Trained inference outputs are written under `data/characters/<ownerKey>/applio-inference/<characterId>/<jobId>/output.wav` and served via `/api/characters/applio-inference/file?owner=<owner>&characterId=<id>&jobId=<jobId>`. The worker captures stdout/stderr/command logs and fails if output is missing, empty, traceback-bearing, or byte-identical to the source input.
- Voice Lab reload now recovers trained Applio profile metadata from validated sources in order: saved `characterVoiceProfile.voiceModelArtifacts[]`, builder/autosave profile state, completed owner/character-scoped `start_applio_training` jobs, then durable `training-artifact.json` files under `data/characters/<ownerKey>/applio-models/<characterId>/<jobId>/`. Recovery requires `status=trained`, `mock=false`, `adapter=applio_real_training`, and non-empty `.pth` / `.index` files before hydrating or persisting the profile.
- Manual TEST proof now persists the real `voice-training-8` trained artifact into `data/characters/slrochford12300/voice-training-8.json`; the saved profile includes `voiceModelArtifactId`, `voiceModelArtifacts[]`, `trainingAdapter=applio_real_training`, `trainingMock=false`, model/index paths, dataset manifest paths, and the approved source sample path. A fresh `test_trained_voice` job from this saved profile completed with `mock:false`, `adapter=applio_real_inference`, `outputBytes=888044`, and different input/output SHA256 hashes.
- TEST browser owner continuity now supports `OTG_OWNER_ALIASES`, with local `.env.local` mapping `slrochford:slrochford12300`. This keeps login username `slrochford` scoped to the existing `data/characters/slrochford12300` Voice Lab assets without copying or migrating generated Applio/voice-pack data.
- Real Applio subprocesses run with `cwd=APPLIO_ROOT` so Applio can resolve repo-relative files such as `rvc/lib/tools/tts_voices.json`.
- Applio preprocess now includes `--cut_preprocess`, defaulting to `APPLIO_CUT_PREPROCESS=Skip`. Valid values are `Skip`, `Simple`, and `Automatic`; invalid values fail before training starts.
- Applio extract now includes `--include_mutes`, defaulting to `APPLIO_INCLUDE_MUTES=2`. Valid values are integers from `0` through `10`; invalid values fail before training starts.
- Applio extract now also includes `--cpu_cores`, defaulting to `APPLIO_EXTRACT_CPU_CORES=8` on this worker. Valid values are integers from `1` through `64`; invalid values fail before training starts.
- Applio stage stderr is treated as fatal when it contains a Python traceback or `ValueError:` even if `core.py` exits with code `0`.
- After extract, the worker verifies `APPLIO_ROOT/logs/<modelName>/config.json`, non-empty `filelist.txt`, and extracted feature folders before starting train. Missing or empty training prep now fails immediately instead of running a train stage that cannot produce artifacts.
- Applio train no longer passes `--pitch_guidance`; this installed Applio `core.py train` CLI does not accept it. `APPLIO_PITCH_GUIDANCE` can remain in local env files without affecting the command.
- Applio train now passes checkpoint/export flags supported by the installed CLI: `--save_every_weights` from `APPLIO_SAVE_EVERY_WEIGHTS=True`, `--save_only_latest` from `APPLIO_SAVE_ONLY_LATEST=False`, `--pretrained` from `APPLIO_PRETRAINED=True`, `--custom_pretrained` from `APPLIO_CUSTOM_PRETRAINED=False`, and `--vocoder` from `APPLIO_VOCODER=HiFi-GAN`. Optional `APPLIO_G_PRETRAINED_PATH` and `APPLIO_D_PRETRAINED_PATH` are passed only when custom pretrained mode is enabled and the paths exist.
- Before running real Applio, the worker now validates installed model prerequisites instead of letting `core.py` fail later. For `APPLIO_F0_METHOD=rmvpe`, `APPLIO_ROOT/rvc/models/predictors/rmvpe.pt` must exist. When default pretrained mode is enabled, the selected vocoder generator/discriminator checkpoints such as `APPLIO_ROOT/rvc/models/pretraineds/hifi-gan/f0G40k.pth` and `f0D40k.pth` must exist.
- Source inspection confirmed the installed `core.py train` path invokes `rvc/train/train.py` and then generates an index if the parent process exits `0`. Child-process extraction/training failures can still leave `core.py` able to generate an `.index`, so the worker now treats index-only stdout without epoch/training evidence as failure: `Applio train produced index only; model training did not run.`
- After train, the worker searches `APPLIO_ROOT/assets/weights`, `APPLIO_ROOT/logs/<modelName>`, `APPLIO_ROOT/logs`, `APPLIO_MODELS_ROOT`, and the OTG artifact job root for non-empty `.pth` and `.index` files, preferring paths containing the exact model name. The selected outputs are copied into the character artifact folder and their source paths are recorded in `training-artifact.json`.
- Current Applio status: preprocess, extract, and train can exit `0`, but the latest local run only produced an `.index` because extraction produced no usable F0/filelist training inputs. The installed checkout is missing at least `rvc/models/predictors/rmvpe.pt`; default pretrained HiFi-GAN checkpoints are also absent unless installed separately or `APPLIO_PRETRAINED=False` is chosen intentionally. The worker now fails before train for these cases and still refuses success unless a real `.pth` and `.index` are copied into the OTG artifact folder.

Next:
- Manually prove `test_trained_voice` against the verified real `.pth` / `.index` artifact and confirm the output URL plays in the browser.
- If the saved-profile search still returns no trained artifact lines after reload/save, use the existing training-job reconciliation flow to hydrate the builder profile, then save the character and rerun the search before relying on saved-card status.

## Voice Lab UX Rework

[x] Voice Design user-facing create voice flow simplified
[x] Voice Effects auto-receives locked base voice
[x] Voice Effects defaults to raw approval on Next
[x] Training labels simplified
[x] Training consumes approvedSampleUrl without exposing internals
[x] Test + Preview status cleanup
[x] Create Voice supersedes stale same-character pending jobs
[x] Create Voice shows user-facing queued/running/completed progress
[x] Dev/test Voice Design auto-ticks the existing dev worker endpoint
[x] Qwen3 Voice Design uses structured Voice Model Designer fields
[x] Qwen3 create_voice_sample sends voiceInstruction separately from sampleText
[x] Qwen3 adapter prefers explicit voiceInstruction over legacy candidate records
[x] Voice Design now has a centralized Qwen3-TTS / CosyVoice model configuration and prompt-builder module
[x] Voice Design separates officially documented presets/dialects from prompt-based accent guidance and reference-audio recommendations
[x] CosyVoice instruction prompts use the documented `<|endofprompt|>` format and Chinese dialect instruction phrases
[x] Qwen3-TTS CustomVoice mode exposes official preset speakers; VoiceDesign mode builds natural-language `instruct` prompts from structured controls
[x] Voice Lab status/progress panels cover Voice Design, Voice Effects, Training, and Test + Preview jobs
[x] Saved character cards have confirmation-gated Delete action through the existing character delete route
[x] Voice Design supports uploaded/reference voice samples as `provider: uploaded`
[x] Uploaded voice samples are served through `/api/characters/voice-sample/file` with safe file-name validation
[x] Mock create_voice_sample output is labeled as mock and does not unlock normal training flow unless dev mock training is explicitly allowed

Next:
- Run the first real Applio proof after the local Applio checkout is available at the configured env paths.
## Voice Lab / Voice FX worker dispatch follow-up

- [x] Verified Voice FX payload includes real input.inputPath.
- [x] Verified manual FFmpeg FX succeeds against generated Qwen sample.
- [x] Patched dev worker tick route to allow explicit ownerKey for deterministic TEST diagnostics.
- [x] Patched real apply_voice_fx worker path to complete/fail in a single tick instead of stalling across staged progress ticks.
- [x] Patched dev worker tick route/client to accept a specific jobId so the UI can advance the active Voice Lab job instead of old FIFO backlog.
- [x] Patched Voice Lab dev/test auto-tick to cover active create voice, Voice FX, Training, Test Playback, Preview, and Dub jobs.
- [ ] Browser QA: Apply Voice FX from UI and confirm queued -> completed without manual job repair after real env flags are loaded.
- [ ] Browser QA: Confirm Use Tuned enables after completed fx.wav result hydration.
## Voice Lab / Voice FX UI result hydration fix

- [x] Verified FX backend writes a distinct `fx.wav`.
- [x] Verified voice sample file route serves `file=fx.wav` with `X-OTG-Resolved-File: fx.wav`.
- [x] Patched Voice Lab UI to hydrate tuned preview state from completed `apply_voice_fx.result.processedSampleUrl`.
- [x] Patched Use Tuned to persist `tunedSampleUrl`, `tunedSamplePath`, `tunedFxPreset`, and `tunedSourceJobId` from the completed FX job.
- [ ] Browser QA: Apply Voice FX and confirm tuned preview plays `fx.wav`.
- [ ] Browser QA: Click Use Tuned and confirm selected training voice URL is the FX URL, not the raw base URL.
## Voice Lab / Voice FX control payload fix

- [x] Verified UI requests the generated `fx.wav` URL.
- [x] Identified active Apply Effects pipeline path only passed `inputPath` and `sourceSampleUrl`.
- [x] Patched Apply Effects to pass detailed Voice FX controls into the `apply_voice_fx` job payload.
- [ ] Browser QA: Set extreme FX values and confirm audible change.
- [ ] Browser QA: Confirm latest `voice_fx_params.json` contains slider/control values.
## Voice Lab / Voice FX control payload fix

- [x] Verified latest `voice_fx_params.json` only received minimal input and produced only loudnorm/default filters.
- [x] Patched Apply Effects to send full Voice FX control payload into `apply_voice_fx`.
- [ ] Browser QA: Apply extreme FX settings and confirm `voice_fx_params.json` includes pitch/speed/filter controls.
- [ ] Browser QA: Confirm generated filters are no longer only `aformat=channel_layouts=mono,loudnorm=...`.
- [ ] Browser QA: Confirm audible FX change.
## Voice Lab / Voice FX final payload merge fix

- [x] Confirmed `buildVoiceFxPipelinePayload()` exists and the Apply Effects button calls it.
- [x] Patched `queueCharacterVoicePipelineAction` so `apply_voice_fx` merges `buildVoiceFxPipelinePayload()` at the final `queueCharacterVoiceJob` payload construction point.
- [ ] Browser QA: Apply extreme FX settings and confirm latest `voice_fx_params.json.input` includes pitch/speed/highpass/lowpass/echo/etc.
- [ ] Browser QA: Confirm generated filters are no longer only `aformat=channel_layouts=mono,loudnorm=...`.
- [ ] Browser QA: Confirm audible FX change.
## Voice Lab / Voice FX robust queue payload fix

- [x] Confirmed `buildVoiceFxPipelinePayload()` contains basic and advanced FX controls.
- [x] Patched final `queueCharacterVoiceJob` payload so `apply_voice_fx` directly merges `buildVoiceFxPipelinePayload()`.
- [x] Removed any stale/broken `pipelineExtraInput` block to avoid TDZ/self-reference errors.
- [ ] Browser QA: Apply extreme FX settings and confirm latest `voice_fx_params.json.input` includes all basic and advanced controls.
- [ ] Browser QA: Confirm filters are no longer only `aformat=channel_layouts=mono,loudnorm=...`.
- [ ] Browser QA: Confirm audible FX change.
- [x] Character Builder: saved-character strip is only shown on the source/front page; active create-character drafts keep autosaving and long Voice Lab jobs continue through the persistent worker.

## Character Builder split-flow persistence patch

- [x] Added server-backed Character Builder draft API at pp/api/characters/builder-draft/route.ts.
- [x] Added card-only completion API at pp/api/characters/complete-card-only/route.ts.
- [x] Added persisted character records for completed card-only characters with
oiceStatus: "none" and hasCustomVoice: false.
- [x] Patched CharactersPanel with autosave/restore for builder state.
- [x] Added fallback actions: Complete Character Card and Next: Voice Lab.
- [x] Replaced fallback floating action bar with native in-panel Complete Character Card button.
- [x] Added native disabled Add Voice button to saved-character cards.
- [ ] Convert direct Character Image/Card Comfy calls into durable server jobs if still browser-bound.
## Character Builder native card/voice split

- [x] Character Card can now be completed without Voice Lab.
- [x] Saved characters without a custom voice expose Add Voice.
- [x] Saved characters with a custom voice show Voice Added and disable Add Voice.
- [x] Add Voice resumes the builder in Voice Lab for the selected saved character.
## Character Builder card-only completion

- [x] Added Save Character Card Only on the Character Details step.
- [x] Card-only save creates a completed saved character without requiring Voice Lab.
- [x] Saved characters without a custom voice show Add Voice.
- [x] Saved characters with an existing voice show Voice Added and disable Add Voice.
- [ ] Browser QA: Save a card-only character, confirm it appears in Saved Characters, then click Add Voice.
## Production saved-character picker source fix

- [x] Production From Characters picker now uses the same character namespace as the Characters tab.
- [x] Production picker now accepts preview/full-body/image/card image path fallbacks.
- [x] Production picker list is sorted for predictable mobile use.
- [x] Old Production picker characters `voice-training-8`, `Aeyolie`, and `Broy` were archived from active saved-character JSON when present.
- [ ] Browser QA: confirm Mr. Red & Black appears in Production > From Characters.
- [ ] Browser QA: confirm old stale Production characters no longer appear.
## Production character card reference only

- [x] Production chooser can still display the saved character thumbnail/name.
- [x] Selecting a saved character now applies the saved character card/reference sheet to the scene slot.
- [x] Characters without a saved character card are excluded from Production From Characters selection.
- [x] Scene reference prompt rules now treat multi-angle character cards as one character identity, not multiple people.
- [ ] Browser QA: Choose Mr. Red & Black from Production and confirm the scene slot uses the character card image.
- [ ] Browser QA: Build Reference Card and confirm it describes all angles/close-ups as one character identity.
## Production picker shows all saved characters

- [x] Production From Characters picker uses the same saved-character namespace as the Characters tab.
- [x] Picker tiles show all saved characters that have a display image.
- [x] Selecting a character applies only the saved character card/reference sheet to the scene slot.
- [x] Characters missing a saved card are shown but blocked with a Missing character card label.
- [ ] Browser QA: Mr. Red & Black appears in Production > From Characters.
- [ ] Browser QA: Selecting Mr. Red & Black applies the character card, not the full-body portrait.
## Production picker definitive repair

- [x] Replaced Production saved-character picker loader.
- [x] Picker now tries Characters-tab device context first.
- [x] Picker now shows saved characters with display images.
- [x] Picker uses character card/reference sheet only when applying to scene slots.
- [x] Characters missing cards are visible but blocked with Missing character card.
- [ ] Browser QA: confirm Mr. Red & Black appears in Production picker.
- [ ] Browser QA: confirm selecting Mr. Red & Black applies the character card/reference sheet.
## Voice Lab mock removal / real worker requirement

- [x] Mock `create_voice_sample` results are rejected instead of persisted as usable voices.
- [x] Voice Effects is blocked when the base voice result is mock.
- [x] `.env.local` now enables real Qwen3, CosyVoice, and Voice FX adapters for TEST.
- [x] Added TEST dev/worker startup scripts for real voice generation.
- [ ] Browser QA: Create Voice with Qwen3 and confirm result has `mock:false`.
- [ ] Browser QA: Create Voice with Cosy and confirm result has `mock:false`.
- [ ] Browser QA: Confirm no "Mock voice created" success state appears.
## CharactersPanel mock voice rejection repair v2

- [x] Replaced create_voice_sample completion hydration so mock results are rejected.
- [x] Voice Effects remains locked unless the base voice profile is real.
- [x] Old local mock base voice profile is cleared after draft hydration.
- [ ] Browser QA: click Create Voice with worker off and confirm no mock success appears.
- [ ] Browser QA: start real worker and confirm Create Voice produces `mock:false`.
## Create Voice no-op auto-tick disabled

- [x] Browser dev auto-tick no longer advances `create_voice_sample` jobs through the no-op worker.
- [x] `create_voice_sample` now polls the persisted job and waits for the real Qwen3/Cosy worker.
- [ ] Browser QA: click Create Voice and confirm it stays queued/running until the real worker completes.
- [ ] Browser QA: confirm completed result has `mock:false`.
## Voice prompt snapshot clean generation v2

- [x] Prompt preview starts empty until Generate Voice Options is clicked.
- [x] Changing voice controls clears generated prompt/options/selection.
- [x] Generate Voice Options creates a fresh provider-specific prompt snapshot.
- [x] Candidate prompts no longer append stale variant text onto prior prompts.
- [x] Create Voice requires a generated prompt snapshot and selected option.
- [x] Create Voice sends the selected snapshot, not live/stale prompt state.
- [ ] Browser QA: change tone/accent/age repeatedly and confirm the preview clears each time.
- [ ] Browser QA: generate options and confirm Create Voice job input contains only the current prompt.
## Repaired queueCharacterVoicePipelineAction syntax

- [x] Replaced malformed `queueCharacterVoicePipelineAction` block created by the prompt snapshot patch.
- [x] Restored TypeScript syntax around Create Voice job queueing.
- [x] Create Voice now requires a generated prompt snapshot before queueing.
- [ ] Browser QA: Generate Voice Options, select an option, then Create Voice.
- [ ] Browser QA: inspect newest job input and confirm no stale prompt fragments.
## IndexTTS2 200-clip same-speaker clone pipeline

- [x] Added `scripts/index_tts2_clone_pack_bridge.py`.
- [x] Redirected Cosy voice-pack batch bridge to IndexTTS2 clone mode.
- [x] Redirected Qwen voice-pack batch bridge to IndexTTS2 clone mode.
- [x] Voice-pack generation now uses one approved `reference.wav` as the speaker identity anchor for every clip.
- [x] IndexTTS2 generation uses `use_random=False` to preserve cloning fidelity.
- [x] `.env.local` and worker startup script now point to `C:\AI\Voices\IndexTTS2`.
- [ ] Browser QA: create/approve one Qwen3 or Cosy base voice.
- [ ] Browser QA: generate 200 training clips and confirm clips sound like the same speaker with varied delivery.
- [ ] Browser QA: train Applio only after confirming same-speaker consistency.
## Prepare Voice Pack uses IndexTTS2 final

- [x] Direct IndexTTS2 25-clip clone test passed.
- [x] Cosy voice-pack bridge redirects to IndexTTS2.
- [x] Qwen voice-pack bridge redirects to IndexTTS2.
- [x] Prepare Voice Pack now uses the approved reference voice as `reference.wav`.
- [x] Prepare Voice Pack generates same-speaker IndexTTS2 clone clips for Applio training.
- [x] IndexTTS2 generation requires `use_random=False`.
- [x] Worker hardening: real `generate_training_dataset` now uses IndexTTS2 batch clone mode for both Qwen3 and Cosy approved sources. The reference WAV is the canonical approved sample after Voice FX approval, so a tuned `fx.wav` is cloned into every training clip when the user chooses Use Tuned.
- [x] Bridge hardening: `scripts/index_tts2_clone_pack_bridge.py` now accepts the worker `--params-json` contract and honors `clip_id` / `output_wav`, preventing proxy calls from losing the intended reference/clip paths.
- [x] Added dedicated Windows voice dataset worker entrypoints: `scripts/windows/otg-voice-dataset-worker.py` and `scripts/windows/otg-voice-dataset-worker.ps1`. This worker claims only `character_voice_pipeline / generate_training_dataset`, uses the approved reference path/URL fields including tuned Voice FX references, uploads clips in batches, updates durable progress as `Generated X / 200 clips`, and completes only after the returned manifest is `generationMode:"real"`, `provider:"indextts2"`, and `voice_pack_ready`.
- [x] Phase 2 dedicated worker now supports universal all-user claim through `OTG_WORKER_TOKEN`. The Windows supervisor no longer requires `-OwnerKey`; it polls `/api/worker/jobs/claim` with `claimScope:"all_owners"` and can claim any queued `character_voice_pipeline / generate_training_dataset` job while preserving the claimed job's original `ownerKey` for upload/complete/fail.
- [x] Phase 3 dedicated Voice Design worker entrypoints added: `scripts/windows/otg-voice-design-worker.py` and `scripts/windows/otg-voice-design-worker.ps1`. This supervisor requires `OTG_WORKER_TOKEN`, claims only `character_voice_pipeline / create_voice_sample` across owners, starts Qwen3-TTS or CosyVoice only after a job is claimed, uploads `sample.wav` to `voice-samples/<characterId>/<jobId>/`, then completes the job with `mock:false`, provider/adapter, sample URL/path, and log paths.
- [x] Generic worker claim/complete/fail and voice-sample upload now support token-authenticated cross-owner Voice Design completion while preserving the claimed job's `ownerKey`. The universal claim allowlist remains strict and does not expose production, animation, dataset, Applio training, or Applio inference jobs to the Voice Design worker.
- [x] Create Voice worker progress repair: added token-authenticated `/api/worker/jobs/checkpoint`, updated the dedicated Voice Design worker to checkpoint `Voice creating started`, generation, upload, and finalization progress, and updated the launcher to load TEST `.env.local` values so Qwen3-TTS/CosyVoice bridge paths are available when the Windows worker starts.
- [x] Qwen3 create_voice_sample worker repair: `otg-voice-design-worker.py` now uses `QWEN3_TTS_API_URL` / `QWEN3_TTS_URL` first for real `/synthesize` output, and `scripts/windows/otg-voice-qwen3-worker.ps1` starts the create-voice worker with Qwen3 API defaults.
- [x] LTX Voice Design Patch 1 TEST only: added the `LTX Voice Sample.json` workflow preset, 52 LTX dialect/stylized spoken lines, LTX Voice prompt builder/UI option, and fixed Qwen3TTS/CosyVoice Character Builder controls to English with no accent picker.
- [x] LTX Voice Design picker UX: dialect options are alphabetized and the visible Sample phrase now syncs to the selected dialect line until manually edited.
- [x] LTX Voice accepted dialect finalization: dropdown now exposes only the 28 accepted dialects, sample phrases use accepted audition lines, positive prompts avoid unwanted-audio wording, and node 370 receives the dedicated negative prompt.
- [x] LTX Voice Design Patch 2 TEST only: `provider: ltx` create-voice jobs now queue with dialect/prompt metadata, the dedicated Windows LTX worker patches `LTX Voice Sample.json`, submits to ComfyUI, copies node 384 MP3 audio only, and completes with `mock:false` / `ltx_audio_voice_sample`.
- [x] TEST launcher now starts the Voice Design Worker for Qwen3/Cosy `create_voice_sample` jobs and the Voice LTX Worker for `provider: ltx` jobs after Next TEST starts.
- [x] LTX Voice workflow node 384 audio input repaired from missing node 385 to audio decode node 354.
- [x] LTX Voice workflow audio decode chain repaired: node 354 now receives samples from node 366 and audio VAE from node 336.
- [x] LTX Voice Sample workflow replaced with corrected uploaded `ComfyUI_00021_.json`; audio chain now decodes node 366 through node 354 and saves MP3 through node 384.
- [x] LTX Voice Design Patch 3 TEST only: LTX audio samples now expose Remove Background Sound / Effects and Enhance Voice post-processing actions, save isolated/enhanced audio beside the original sample, keep the original playable, and preserve audio-only UI behavior.
- [x] LTX Voice Patch 3 JSON-body fix: post-processing buttons now send explicit JSON request payloads with local sample paths, and the process route clones/parses safely before owner resolution.
- [x] Create Again now submits a fresh random `seed` / `requestSeed` into the `create_voice_sample` job input so each request is a new generation attempt.
- [x] Unnatural Voices Patch 1 TEST only: added the 31-preset Unnatural Voices registry, separate Character Builder selection UI with category/preset selectors, fixed sample line and prompt preview, and blocked generation with the Patch 2 placeholder so no normal LTX dialect job is queued.
- [x] Unnatural Voices Patch 1 registry source repaired: placeholder prompt text was replaced with exact final uploaded LTX 2.3.1 prompts from `ltx_31_final_unnatural_voice_prompts.json`.
- [x] Unnatural Voices Patch 2: selected fixed presets now queue `provider: unnatural_ltx` create-voice jobs, the LTX worker patches the preset prompt into node 360, patches node 370 negative prompt, randomizes node 333/334 seeds, returns audio-only `ltx_unnatural_voice_sample` results, and reuses LTX audio cleanup/enhancement.
- [ ] ElevenLabs Experimental: pending separate provider work; not part of Unnatural Voices Patch 1.
- [ ] Browser QA: start the dedicated Voice Design worker with `OTG_WORKER_TOKEN`, create a Qwen3-TTS voice, and confirm the completed job has `mock:false`, a playable `sampleUrl`, and `qwen3_real_voice_sample`.
- [ ] Browser QA: repeat Create Voice with CosyVoice and confirm the completed job has `mock:false`, a playable `sampleUrl`, and `cosy_real_voice_sample`.
- [x] Dataset worker lifecycle now separates worker readiness from user finalization. Worker completion marks the job `ready_for_review`; the UI exposes Preview Samples, Complete Dataset, and Terminate. Complete Dataset revalidates the manifest and finalizes the job to `completed`, which unlocks Train Voice Model.
- [x] Dataset termination quarantines partial dataset files under `training-datasets/<characterId>/terminated/<jobId>/`, marks the job `terminated`, and blocks further uploads/claims for that session. Resume requeues failed/canceled jobs and preserves existing ready clips through manifest/file checks.
- [x] Training dataset file serving accepts safe `index=<n>` lookup from the manifest, enabling a compact one-audio-player sample preview instead of rendering 200 players.
- [x] Voice Lab dataset/model jobs now use durable worker lease fields (`workerId`, `claimedAt`, `heartbeatAt`, `leaseExpiresAt`, `attempt`, `lastProgressAt`, `interruptedAt`, `resumeCount`) so browser activity does not control execution.
- [x] Stale `running` dataset/model jobs automatically become `interrupted`/resumable after the worker lease expires; active jobs with fresh heartbeats are not reclaimed.
- [x] Dataset worker claim priority is deterministic: queued `generate_training_dataset` jobs win first with newest queued job first for TEST interactivity; interrupted jobs remain visible but are not auto-claimed unless the user explicitly clicks Resume and the job receives `resumeRequestedAt`.
- [x] Universal Windows dataset worker claim ignores plain old interrupted jobs from older characters, so stale resumable sessions no longer block the newest/current queued dataset job.
- [x] New dataset requests for the same character supersede active queued/running or resume-requested dataset jobs while leaving old plain interrupted history visible for manual review/resume.
- [x] Dataset jobs now remain `queued` until a Windows worker claim sets `workerId`, `claimedAt`, `heartbeatAt`, and `leaseExpiresAt`. Legacy/invalid `running` dataset jobs with no worker lease are normalized: 0 generated clips returns to queued, while partial generated clips become interrupted/resumable.
- [x] Dataset progress is clip-count based. `0 / 200` now renders as `0%`, not the old no-op worker 70% floor.
- [x] Local/dev voice pipeline worker no longer claims `generate_training_dataset` by default. Dataset jobs stay queued for the dedicated Windows dataset worker unless `OTG_ALLOW_LOCAL_DATASET_WORKER=1` is explicitly set for dev tests.
- [x] Dataset jobs accidentally leased by `local-voice-pipeline-worker` are released during job-store reads: 0 generated clips returns to queued, partial clips become interrupted/resumable with a message to resume using the Windows dataset worker.
- [x] IndexTTS2 dataset worker checkpoints progress/heartbeat during generation and resumes from the server-known ready clip count instead of regenerating ready clips.
- [x] Persistent Windows dataset supervisor command no longer requires `-OwnerKey` or command-line worker token; it reads `OTG_WORKER_TOKEN` from the user environment or TEST `.env.local`.
- [x] Added a dedicated persistent Windows Applio training supervisor: `scripts/windows/otg-voice-applio-worker.ps1` / `.py`. It claims only `character_voice_pipeline / start_applio_training` across owners with `OTG_WORKER_TOKEN`, preserves the claimed job's `ownerKey`, runs Applio on Windows, checkpoints preprocess/extract/train/package stages, and completes only after non-empty `.pth` and `.index` artifacts are copied into the character `applio-models` folder.
- [x] Local/dev voice pipeline worker no longer claims `start_applio_training` by default. Applio model jobs stay queued for the dedicated Windows Applio worker unless `OTG_ALLOW_LOCAL_APPLIO_WORKER=1` is explicitly set for dev tests.
- [x] Applio subprocesses now force PyTorch distributed rendezvous to localhost with `MASTER_ADDR=127.0.0.1`, per-job `MASTER_PORT`, and `TORCH_DISTRIBUTED_DEBUG=DETAIL`; these values are recorded in `applio-commands.json`.
- [x] Applio worker lease heartbeat now runs during long `core.py` subprocess stages. The worker captures stdout/stderr on reader threads, checkpoints `Applio <stage> running` every `OTG_APPLIO_WORKER_HEARTBEAT_SECONDS` seconds, and kills the child process tree if the job is stopped, terminated, or completed elsewhere.
- [x] Voice pipeline `[jobId]` PATCH body parsing now reads the request body directly and parses JSON reliably for `resume`, `terminate`, `stop`, and `complete_dataset`. Completed dataset idempotency still returns success before body parsing so stale retries with empty bodies do not fail.
- [x] `start-otg-test-services-v2.bat` was rebuilt into a clean TEST launcher with one copy of each label, dataset worker startup preserved, and new `START_VOICE_APPLIO_WORKER=1` startup after Next TEST and the dataset worker. Worker duplicate detection uses `tasklist /v` window-title checks.
- [x] Voice Lab source lock-in: created Qwen3-TTS/CosyVoice samples, uploaded samples, and completed Voice FX outputs now remain detectable across Voice Design, Voice FX, and Training. Dataset/model training queues only when the selected source is a local `approvedSamplePath` or a resolvable `/api/characters/voice-sample/file` URL.
- [ ] Browser QA: create/approve base voice, click Prepare Voice Pack, confirm IndexTTS2 output metadata.
- [ ] Browser QA: listen to random generated clips before Applio training.
## Minimal Training page UI v2

- [x] Removed duplicate Voice Training Prep / Prepare Voice Pack panel from Training page.
- [x] Training page now focuses on Prepare Voice Training Dataset and Train Voice Model.
- [x] Prepare button is larger and includes the 30-90 minute warning.
- [x] Dataset status is always visible and shows Ready after clip generation completes.
- [x] Train Voice Model stays disabled until the dataset is ready.
- [x] Fast / Normal / Quality presets remain available before training.
- [ ] Browser QA: confirm Training page only shows the minimal two-step flow.
- [ ] Browser QA: confirm Train Voice Model unlocks only after dataset status says Ready.

## Angles / TripoSplat SPZ Viewer

- [x] TEST only: replaced Angles 3D Model path with TripoSplat-backed .spz output.
- [x] TEST only: removed stale Textures tab/action path from Angles UI.
- [x] TEST only: added Spark-based .spz viewer support for generated Gaussian splat models.
- [x] TEST only: fixed SPZ viewer orientation, target locking, camera sync, and initial framing.
- [x] TEST only: constrained Angles camera controls to prevent invalid ComfyUI vertical angle submissions.
- [ ] TEST only: wire Create Angles Image to capture the Spark/SPZ viewer canvas directly.

## Character Builder Standard / Freeform separation

- [x] Patch 1 TEST only: Character Builder entry page now separates Create Standard Character, Upload Standard Character Image, Create Freeform Character, and Upload Freeform Character Image.
- [x] Patch 1 TEST only: builder draft state now stores `characterAnatomyMode`, `characterInputMode`, `sourceFraming`, and `fullBodyStatus`.
- [x] Patch 1 TEST only: Freeform Create adds full-body/full-form, natural-anatomy prompt constraints without changing Standard Create behavior.
- [x] Patch 1 TEST only: Upload source framing now uses the canonical `face`, `half_body`, and `full_body` field while preserving the older `imageCompleteness` draft field for compatibility.
- [x] Patch 2 TEST only: add upload source framing prompts and downstream gating so Character Card, Angles, Voice Preview finalization, and Complete Character require approved full-body/full-form status when needed.
- [x] Patch 3 TEST only: branch edit-image full-body expansion prompts for Standard versus Freeform uploads and save the approved full-body/full-form result.
- [x] Patch 4 TEST only: auto-run background removal after Freeform final full-body/full-form approval and require explicit Freeform full-body/full-form confirmation before downstream steps.

## Character Builder Auto Describe responsiveness

- [x] TEST only: Auto Describe now prefers the approved selected character source, uses a compact OllamaVision JSON prompt, runs with a hard timeout, and keeps manual fields intact on failure.
- [x] TEST only: Auto Describe now uses an aggressive 512px JPEG fast path, Auto Describe-specific Ollama env overrides, and concise server timing logs.
- [x] TEST only: Complete Description Patch 1 renames the Character Builder action, creates a lockable character identity data model, and saves prompt-ready continuity metadata without changing provider routing.
- [x] TEST only: Complete Description Patch 2 adds an OpenAI-first provider ladder with local Ollama fallback, compact JSON validation, provider timing logs, and manual-detail-aware prompts.
- [x] TEST only: Complete Description Patch 3 injects locked prompt-ready character continuity blocks into production scene/global prompts and blocks selected-character generation when any selected card lacks a locked identity.
- [x] TEST only: Complete Description path resolution now accepts safe project data paths and `/api/file?path=...` image URLs so final Character Builder images can reach the provider ladder without weakening path security.
- [x] TEST only: Complete Description clothing extraction now separates descriptor-like manual text from real outfit/accessory items and builds cleaner prompt-ready identity anchors.







- [x] ElevenLabs Experimental preview-only backend Patch 1: added server-side status/design-preview/file routes. Preview audio is saved locally only; no permanent ElevenLabs voice creation endpoint is called.

- [x] Voice Effects backend Patch 1: added FFmpeg-backed Space/Distance, Machine/Digital, and Creature/Alien effect presets plus backend processing route. UI integration remains pending.


- [x] Voice Effects UI Patch 2: added category/preset/intensity controls for FFmpeg-backed voice effects under completed voice samples. Original audio remains preserved.


- [x] Voice Effects Rework Patch 3A: reworked Voice Effects into Base Voice, Simple Effects, Advanced FFmpeg/Pedalboard/SoX boxes, current working voice, reset, and effect chain UI. Pedalboard/SoX backend wiring remains Patch 3B.


- [x] Voice Effects Rework Patch 3A-FXPage: reworked the actual Voice Lab Step 2 FX page with Simple Pitch/Echo controls, FFmpeg/Pedalboard/SoX advanced boxes, current working voice, effect chain, reset, and Use This Version. Pedalboard/SoX backend remains Patch 3B.


- [x] Voice Effects Backend Patch 3B: wired Pedalboard and SoX backend preset execution into the voice-sample effect route and enabled the real Voice FX page buttons. Manual unlocked controls remain Patch 3C.


- [x] Voice Effects Cleanup Duplicate Job Panel: removed the temporary duplicate Voice Effects UI from completed job cards; the real Step 2 Voice Effects page remains the only active effects interface.


- [x] Voice Effects Patch 3C-1: added unlocked editable FFmpeg manual controls, custom FFmpeg filter payload support, and chain stacking warning. Pedalboard/SoX manual controls remain pending.


- [x] Voice Effects Patch 3C-2: added unlocked editable Pedalboard and SoX manual controls with backend custom-control payload support.


- [x] Voice Effects Final Polish Patch 3D: removed stale backend-pending wording, added Pedalboard/SoX manual reset buttons, and marked Voice Effects functional implementation complete pending runtime spot-checks.

## Automatic video backend failover

- [x] TEST only: images remain pinned to `COMFYUI_IMAGE_URL`; video routing now health-checks RTX 3090 `/system_stats` with a short timeout before submission.
- [x] TEST only: compatible video jobs fall back to RTX 5060 Ti only when the 3090 is unavailable or explicitly rejects `/prompt`; ambiguous post-dispatch network failures never retry, preventing duplicate generations.
- [x] TEST only: added workflow compatibility modes (`compatible`, `3090_only`, `reduced`) with conservative 3090-only default and workflow-specific caps for width, height, frames, and batch size.
- [x] TEST only: fallback submission validates required ComfyUI node classes and referenced model filenames through fallback `/object_info` before queuing.
- [x] TEST only: job logs and API responses record backend ID, URL, GPU, fallback state, reductions, and validation results.
- [x] TEST only: UI status exposes the active video backend and whether fallback is active.
- [x] Contract tests: primary selection, safe reduced fallback, unknown/3090-only rejection, and link-preserving reductions pass (6 tests).
- [x] Runtime TEST QA: with RTX 3090 online, compatible prompt `e16076c4-6dee-434a-b493-0ce6d2b20c7c` was accepted only by RTX 3090.
- [x] Runtime TEST QA: with RTX 3090 unavailable, RTX 5060 Ti validated all required LTX models/custom nodes and completed the unchanged default-quality prompt `65cc60f7-25e6-4e07-8c64-76a6a45f52c9` as `LTX-2.3_00001-audio.mp4` in 490.52 seconds.
- [ ] Runtime TEST QA: with RTX 3090 offline, submit a 3090-only workflow and confirm the exact no-compatible-fallback error.
- [ ] PROD promotion requires explicit user approval after TEST QA; do not alter current PROD image-routing overrides.

## Generate page image workflow redesign

- [x] TEST patch: define Image Generation and Video Generation as mutually exclusive top-level modes, with Image Generation active by default.
- [x] TEST patch: add Create an Image, Edit an Image, and Create an Anime Image workflow selection.
- [x] TEST patch: register Ernie Image Turbo, Z Image Turbo, Krea 2 Turbo, Boogu Image 0.1 Turbo, and Anima Base V1 API workflows.
- [x] TEST patch: register Qwen Image Edit 2511 INT8, FireRed Image Edit 1.1, and Qwen Image Edit API workflows.
- [x] TEST patch: lock image output to 1280x720 landscape or 720x1280 portrait.
- [x] TEST patch: filter LoRA choices by selected model; expose Krea Darkbrush and preserve each edit workflow's bundled Lightning LoRA.
- [x] TEST patch: allow up to three reference uploads for Qwen Image Edit 2511 INT8 and FireRed Image Edit 1.1; keep legacy Qwen Image Edit limited to one.
- [x] TEST patch: remove the redundant Regenerate concept; repeated Generate submissions create new results and successful SaveImage outputs continue syncing to Gallery.
- [x] TEST UI cleanup: remove the user-facing Negative Prompt panel and Generate preview Characters callout while preserving workflow-authored negative conditioning and keeping Characters as an independent main-navigation tab.
- [x] TEST LoRA rework: add model-specific Ernie, Z Image, and Krea LoRA catalogs with descriptions, usage guidance, mature-content labels, and a three-selection maximum; Boogu remains empty until a verified compatible LoRA is installed.
- [x] TEST LoRA safety: require a versioned 18+ responsibility acknowledgement in both the Generate UI and server request before any optional image LoRA can be submitted.
- [x] TEST LoRA routing: preserve Krea's authored Darkbrush switch, chain additional selected LoRAs without overwriting workflow defaults, reject cross-model/duplicate/over-limit selections, and verify every selected filename against the active ComfyUI backend before `/prompt`.
- [x] TEST LoRA administration: protect shared catalog add, display-name/description update, model assignment, enable/disable, and app-only removal behind the existing admin authorization contract.
- [x] TEST LoRA administration UI: keep the Admin LoRA Manager collapsed by default with an accessible native expand/collapse control.
- [x] TEST LoRA synchronization: scan both ComfyUI LoRA inventories, add new files as disabled review items, flag backend-specific missing files, and automatically disable entries missing from every healthy backend without deleting model files.
- [x] TEST LoRA strength: let each user adjust every selected LoRA from 0.00 through 2.00, clamp the value server-side, and apply it to both authored workflow LoRA nodes and dynamically chained nodes.
- [x] Contract tests cover model grouping, locked 720p sizes, multi-reference limits/connections, and optional LoRA switching.
- [ ] Runtime TEST QA: confirm the adult acknowledgement, three-LoRA maximum, model filtering, and active-backend missing-LoRA rejection in the deployed UI.
- [ ] Runtime TEST QA: verify required models and custom nodes for all eight image workflows on both image backends before enabling image failover.
- [ ] Runtime TEST QA: submit portrait and landscape output for each image workflow and confirm Gallery ingestion.
- [ ] Runtime TEST QA: submit one-, two-, and three-reference jobs for both multi-reference edit workflows.
- [ ] PROD promotion requires explicit user approval.

## Generate page video workflow redesign

- [x] TEST structure: expose only Create Video, Create Video with Starter Image, and Create First and Last Image Video.
- [x] TEST structure: add LTX 2.3 and WAN 2.2 model selectors followed by SafeTensor and GGUF format selectors.
- [x] TEST routing guard: map the three existing LTX 2.3 SafeTensor workflows and the six supplied WAN 2.2 SafeTensor/GGUF workflows; keep unprovided LTX GGUF combinations visibly pending and impossible to submit.
- [x] TEST inputs: require no image for text-to-video, one starter image for starter-image video, and both first and last images for the transition workflow.
- [x] TEST cleanup: Prompt Relay, custom-audio video, and video upscaler workflows are no longer exposed from Generate.
- [x] Contract tests cover the three-workflow limit, two model families, two formats, exact current SafeTensor IDs, and pending-combination routing guards.
- [ ] Add and validate the three LTX 2.3 GGUF workflow JSON files.
- [x] Add and validate WAN 2.2 text-to-video, starter-image, and first/last-frame workflow JSON files in both SafeTensor and GGUF formats.
- [x] Lock WAN video output to 24 FPS and 720p in 1280 x 720 landscape or 720 x 1280 portrait.
- [x] Map 5 / 10 / 15 seconds to WAN-compatible 121 / 241 / 361 frame counts.
- [x] Prune inactive output/model branches before submission so only the selected SafeTensor or GGUF graph can run.
- [x] Keep BoundBite GGUF first/last-frame on its baked-in four-step checkpoint without stacking a speed LoRA.
- [x] Classify all six WAN workflows as RTX 3090-only until exact model/node availability and 15-second VRAM use are proven on the RTX 5060 Ti; no reduced-quality fallback is enabled.
- [x] Add model-specific Video LoRA catalog infrastructure after auditing all nine exposed workflow loader contracts; activate only entries with complete saved metadata and keep incomplete entries `metadata_pending`.
- [ ] Runtime TEST QA on RTX 3090 and RTX 5060 Ti before any PROD promotion.

## TEST Video LoRA support — 2026-07-19

- [x] Back up every planned modified existing file outside the repository at `/home/shawn-rochford/AI/work/OTG-Test2-backups/video-lora-support-20260719-085643` before source edits.
- [x] Audit the three exposed LTX and six exposed Wan graphs independently, including loaders, internal LoRAs, branches, insertion points, and current backend status.
- [x] Query `/models/loras`, `/object_info/LoraLoaderModelOnly`, and the rgthree Power LoRA node on RTX 3090 and RTX 5060 Ti without reading server filesystem paths.
- [x] Add the seven-entry saved LTX catalog; activate OmniCine and Cinematic Hard Cut, and keep entries with missing creator metadata or unsupported V2V dependencies unselectable.
- [x] Exclude Wan LightX2V acceleration and all uncataloged filename-inferred LoRAs from user selection.
- [x] Add a 45-second cached inventory endpoint, refresh support, catalog-only filename resolution, and no absolute-path exposure.
- [x] Enforce maximum two, duplicate/unknown/traversal/pending/family/workflow/mode/range/backend checks with clear 400/409 errors.
- [x] Add immutable standard-loader chains at explicit fail-closed patch points for Wan T2V/I2V/FLF GGUF/SafeTensor and LTX T2V/I2V/FLF SafeTensor.
- [x] Preserve authored internal LoRAs, Wan high/low branches, LTX base/refinement paths, SageAttention, sampling, chunk feed-forward, previews, CLIP isolation, Wan five-second timing, and LTX duration choices.
- [x] Make selected user LoRAs part of backend compatibility; never remove a selection during fallback and retain the no-dual-submit/no-ambiguous-retry contract.
- [x] Add the responsive Video LoRAs UI, installed/family/mode/tutorial/license information, explicit trigger-word action, two-LoRA count, and Wan high/low advanced controls.
- [x] Pass focused deterministic tests: 5 files / 54 tests; final routing/catalog/UI regression run 3 files / 41 tests.
- [x] Pass full Vitest (29 files / 279 tests), final Node 20.20.2 TypeScript, and a clean Next.js standalone build.
- [ ] Activate the packaged TEST-only standalone release `video-lora-support-20260719-091121`; activation is blocked because `otg-test.service` restart requires interactive sudo. The prior TEST symlink was restored and neither TEST nor PROD was restarted.
- [x] Physically generate and visually inspect LTX T2V, LTX image, and a two-LoRA stack on RTX 3090 using the audited patched graphs. Record prompt IDs, output facts, elapsed time, VRAM, and visual observations in the test matrix.
- [ ] Physically generate Wan T2V and Wan I2V/FLF after an administrator supplies at least one complete curated Wan catalog mapping. Current inventory has Wan-named files but no authorized compatibility/usage/license mapping; LightX2V is not an acceptable substitute.
- [x] Reject a missing-backend LoRA and an incompatible-family selection through the packaged API with HTTP 409 before submission.



- [x] `OTG_WAN_RIFE_16_TO_24_V1` — TEST WAN 2.2 workflows generate natively at 16 FPS (81/161/241 frames for 5/10/15 seconds), then use `RIFE VFI` with an exact alternating-pair 3:2 schedule for 121/241/361 frames at 24 FPS. SafeTensor and GGUF T2V, I2V, and first/last-frame workflows share the same runtime contract. PROD is unchanged.

- [x] TEST dual-GPU capability routing: prefer RTX 3090, permit RTX 5060 Ti only for manifest-verified workflows, validate live nodes/models/health, and prevent duplicate retry submissions.
- [x] TEST dual-GPU matrix: verify six Wan modes on RTX 3090 and six image workflows on RTX 5060 Ti with cold/warm downloaded-output evidence; retain explicit unsupported reasons for all other combinations.
- [ ] Obtain authenticated read-only/maintenance access to the RTX 5060 Ti host before aligning custom-node commits or sharing/copying additional models; SSH key authentication was rejected during this audit.

## TEST production readiness and later PROD promotion

- [x] Capture the initial git, TEST unit/drop-in/launcher, listener, Node, release-layout, source-build, and read-only PROD discovery audit.
- [x] Back up the pre-readiness worktree outside the repository at `/home/shawn-rochford/AI/work/OTG-Test2-backups/prod-readiness-20260718-225428`.
- [x] Confirm the known working TEST release remained active and healthy before packaging work.
- [x] Add explicit contracts for hidden Wan Duration UI, LTX 5/10/15 Duration UI, exact FFLF workflow submission, and synchronous duplicate-click exclusion.
- [x] Pass the focused readiness suite: 5 files / 36 tests.
- [x] Pass the full suite: 27 files / 247 tests.
- [x] Pass `npx tsc --noEmit` under Node 20.20.2.
- [x] Pass a clean Next.js 15.5.18 build and confirm `.next/standalone/server.js`.
- [x] Package `/home/shawn-rochford/AI/deploy/otg-test/releases/prod-ready-20260718-231300` from the standalone output with root `server.js`, static/runtime assets, an explicit runtime-helper allowlist, manifests, workflows, no embedded data/environment/database, and no backup directories. The earlier `prod-ready-20260718-225428` candidate was preserved but superseded because its helper-script set was broader than required.
- [x] Validate 78 packaged workflow JSON files using the application's UTF-8 BOM normalization and validate matching capability manifest versions.
- [ ] Activate the candidate TEST release and restart only `otg-test.service`; blocked because this account lacks non-interactive sudo authorization. The activation guard restored the prior symlink and the existing process never stopped.
- [ ] Keep the candidate TEST service stable for at least 30 seconds and verify homepage, login/auth redirect, status, workflows, capability data, static chunks, and clean startup journal.
- [ ] Complete deployed browser verification for Wan T2V/I2V/FFLF hidden Duration, LTX 5/10/15, one Generate Duration card, and selected FFLF workflow preservation.
- [x] Preserve archived 3090/5060 cold/warm matrix evidence and confirm manifests: 13 verified on 3090, 6 verified images on 5060 Ti, and no verified 5060 Ti video workflow.
- [x] Write the read-only TEST-to-PROD difference classification and explicitly record that `/home/shawn-rochford/AI/work/OTG-Stage2` is not authoritative live PROD state.
- [x] Add guarded, non-executed promotion and rollback scripts plus the promotion manifest and checklist.
- [ ] Discover actual PROD host/service/symlink/releases/launcher/Node/environment/data-root/port/current-release values read-only; no local PROD deployment was found.
- [ ] Change `RELEASE_VERIFICATION.json` to `liveTest.status: passed` only after every deployed TEST gate succeeds.
- [ ] Run `shellcheck` on both new scripts when installed; `bash -n` already passes.
- [ ] Obtain explicit approval and a change window before any PROD action. PROD has not been modified or restarted.

### Approved PROD promotion attempt — 2026-07-18 23:35 EDT

- [x] User explicitly approved immediate PROD promotion.
- [x] Re-ran authoritative local discovery for hostname, systemd/user services, launchers, symlinks, deployments, listeners, proxies/tunnels, and PM2.
- [x] Confirmed hostname `shawn`; only `otg-test.service` and `otg-comfyui.service` exist, only TEST listens on port 3001, and no PROD web deployment is installed or running locally.
- [x] Confirmed `otg-prod.service`, `otg-production.service`, and `otg.service` are not found; no PROD current symlink, releases directory, launcher, port, base URL, environment, data root, or active release can be discovered on this machine.
- [x] Confirmed TEST HTTP preflight currently returns 200 for `/`, `/api/comfy-status`, and `/api/workflows`.
- [ ] Activate and live-verify `/home/shawn-rochford/AI/deploy/otg-test/releases/prod-ready-20260718-231300`; TEST still points to `wan-duration-fix-20260718-194611`, and the candidate verification record remains `liveTest.status: blocked`.
- [x] Inspected both guarded scripts. Promotion preserves PROD service configuration/data roots by never writing environment or data paths, excludes environment/database/data/backup files, records the previous release, switches atomically, and rolls back after post-switch failures.
- [x] Backed up the promotion scripts, checklist, manifest, status, and checksums outside the repository at `/home/shawn-rochford/AI/work/OTG-Test2-backups/prod-promotion-20260718-233600`.
- [x] `bash -n` passes for both scripts; `shellcheck` is not installed.
- [ ] Execute PROD promotion. Safety-blocked before script execution because authoritative PROD values do not exist locally and the required TEST live gate has not passed. No PROD or ComfyUI mutation occurred.

### PROD dual-GPU routing deployment — 2026-07-19

- [x] Deployed private branch `prod/dual-gpu-routing-20260719` at exact commit `77a528710f96eaf852e5238037e52ba80ea3808c`.
- [x] Activated new standalone release `/opt/otg/releases/prod-dual-gpu-routing-20260719T043422Z` through `/opt/otg/current-prod`.
- [x] Recorded previous/rollback release `/opt/otg/releases/source-prod-generate-preview-canonical-clean-20260711T034419Z`.
- [x] Verified `otg-prod.service` is active and running on port 3000 with `NRestarts=0`, `ExecMainStatus=0`, and the deployed release SHA marker matching the approved commit.
- [x] Verified homepage and login return HTTP 200; unauthenticated `/app` and `/app/app` redirect to `/login`; `/api/auth/me` returns the expected HTTP 401.
- [x] Verified `/api/comfy-status` and `/api/workflows` return HTTP 200. PROD lists 16 workflows, including six Wan and three LTX workflows.
- [x] Verified backend routing read-only: RTX 5060 Ti image backend is available; RTX 3090 is the available and active video primary; RTX 5060 Ti is the available standby video fallback; fallback is not active.
- [x] Created annotated private deployment tag `prod-dual-gpu-routing-20260719` at `77a528710f96eaf852e5238037e52ba80ea3808c` and pushed it only to `deploy-private`.
- [x] PROD environment files, data roots, databases, uploads, secrets, user content, and both ComfyUI installations were not changed by post-promotion verification.

Exact rollback command:

```bash
sudo ln -s /opt/otg/releases/source-prod-generate-preview-canonical-clean-20260711T034419Z /opt/otg/current-prod.rollback-77a5287 && sudo mv -Tf /opt/otg/current-prod.rollback-77a5287 /opt/otg/current-prod && sudo systemctl restart otg-prod.service
```

<!-- OTG_ANGLES_5060_CAMERA_CONTRACT_START -->
- [x] Angles: confirm active UI path is `AppPageClient.tsx` -> `AnglesPanel.tsx`.
- [x] Angles: confirm RTX 5060 Ti has `QwenMultiangleCameraNode` and all workflow models/LoRAs.
- [x] Angles: route TEST camera-image generation to the RTX 5060 Ti backend.
- [x] Angles: serialize Qwen camera inputs as horizontal `0-359`, vertical `-30..60`, and zoom `0..10`.
- [ ] Angles: physically verify front, left, right, rear, high, low, zoom-out, and zoom-in renders in TEST.
- [ ] Angles: promote the verified Angles camera patch to PROD only after explicit approval.
<!-- OTG_ANGLES_5060_CAMERA_CONTRACT_END -->
- [x] Angles: return only the generated image from ComfyUI output node `110`; ignore the unchanged camera preview emitted by node `93`.

<!-- OTG_CHARACTERS_BOOGU_ALL_SELECTORS_START -->
## TEST Characters Boogu model coverage — 2026-07-19

- [x] Add Boogu Image 0.1 Turbo to the main Create Character model selector.
- [x] Route main character generation through `presets/image_boogu_image_0_1_turbo_t2i` with prompt node `43`, sampler seed node `44`, and output node `33`.
- [x] Add Boogu Image 0.1 Turbo to both Characters Background Studio model-choice groups.
- [x] Preserve Boogu as the recorded provider through preview cleanup and complete background-plate creation.
- [x] Keep character-card and eight-angle workflows exempt from generator-model override.
- [ ] Runtime TEST QA: generate one standard portrait character with Boogu.
- [ ] Runtime TEST QA: generate one freeform landscape character with Boogu.
- [ ] Runtime TEST QA: generate one Background Studio preview with Boogu and complete the background plate.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_CHARACTERS_BOOGU_ALL_SELECTORS_END -->

<!-- OTG_CHARACTERS_MODEL_RUNTIME_HOTFIX_START -->
## TEST Characters model runtime hotfix — 2026-07-20

- [x] Normalize the ZTurbo workflow to UTF-8 without BOM.
- [x] Change the ZTurbo UNET value from `Zturbo/z_image_turbo_bf16.safetensors` to the installed RTX 5060 Ti value `z_image_turbo_bf16.safetensors`.
- [x] Package the Boogu workflow under both `comfy_workflows/presets` and the legacy Characters resolver path `workflows/presets`.
- [x] Map Characters output lookup to ZTurbo node `9`, Krea2 node `29`, and Boogu node `33` with their workflow filename prefixes.
- [x] Poll ComfyUI history for up to 90 seconds after completion to remove the completion/history race.
- [ ] Runtime TEST QA: generate one image with ZTurbo.
- [ ] Runtime TEST QA: generate one image with Krea2 Turbo.
- [ ] Runtime TEST QA: generate one image with Boogu Image 0.1 Turbo.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_CHARACTERS_MODEL_RUNTIME_HOTFIX_END -->

- [x] OTG_COMFY_IMAGE_DUAL_GPU_OUTPUT_LOOKUP_V1: ComfyUI image history/output lookup checks RTX 5060 Ti and RTX 3090 without submitting the workflow twice.

- [~] Characters / 8-angle card: RTX 5060 Ti routing enabled after live node/model inventory validation; end-to-end generated card verification pending.

- [~] Characters / Worker Manager completion: durable saved-for-later character completion job, Worker Manager adapter, 8-angle submission, dual-GPU output lookup, final character persistence, retry-safe job state, and TEST deployment patch prepared. Linux systemd worker installation and end-to-end completion verification pending.


<!-- OTG_LINUX_QWEN3_CHARACTER_VOICE_WORKER_START -->
## TEST Linux Qwen3 character voice worker — 2026-07-20

- [x] Replace the stale `Waiting for Windows voice worker` Character UI status with `Waiting for Linux voice worker`.
- [x] Register the Qwen3 Voice Design Worker as a Linux RTX 3090 Worker Manager lane.
- [x] Keep Qwen3-TTS non-persistent: load the VoiceDesign model only while a real `create_voice_sample` job is running, then release GPU memory.
- [x] Wait for the RTX 3090 ComfyUI queue to become idle and request cached-model release before Qwen3-TTS inference.
- [x] Install a dedicated Linux systemd polling worker using the existing token-protected universal worker-job APIs.
- [x] Preserve the queued real Qwen3 job across browser refreshes and allow the Linux worker to claim it.
- [ ] Runtime TEST QA: existing queued `create_voice_sample` job is claimed by `linux-qwen3-voice-worker`.
- [ ] Runtime TEST QA: a non-empty playable WAV is uploaded and attached to the character.
- [ ] Runtime TEST QA: proceed through Voice Effects and confirm the remaining character-completion stages do not reference unavailable Windows workers.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_LINUX_QWEN3_CHARACTER_VOICE_WORKER_END -->
- [x] Linux CosyVoice3 character voice worker is installed in TEST, claims only provider `cosy`, shares the RTX 3090 voice GPU lock with Qwen3-TTS, and uploads real voice samples through the durable Worker Manager job contract.
- [x] Linux LTX Voice worker infrastructure is installed in TEST: provider `ltx` and `unnatural_ltx` jobs use the RTX 3090 ComfyUI lane, validate required nodes/models before claim, share the Qwen3/CosyVoice GPU lock, and upload node 384 MP3 output.
- [ ] Verify one real Linux `ltx` voice sample and one real `unnatural_ltx` sample remain playable after refresh before marking LTX Voice application output verified.
- [x] LTX Voice loader correction: replace `CheckpointLoaderSimple` for the transformer-only LTX diffusion file with `UNETLoader`, add a separate `VAELoader` for `LTX23_video_vae_bf16.safetensors`, and keep the dedicated LTX audio VAE loader.
- [ ] Runtime TEST QA after loader correction: queue a fresh `ltx` voice job and verify node 384 produces a playable MP3 without restarting ComfyUI.

- [x] LTX Voice text-encoder correction: replace the FP4 mixed Gemma encoder that fails with `Linear.weight` in the current ComfyUI runtime with the official Comfy-Org `gemma_3_12B_it_fp8_scaled.safetensors` encoder.
- [x] Runtime TEST QA after FP8 text-encoder correction reproduced the same node 370 `Linear.weight` failure; replacing the encoder file alone did not correct runtime placement.
- [x] LTX Voice text-encoder placement correction: keep the official FP8 Gemma encoder but force `LTXAVTextEncoderLoader.device=cpu` to bypass the current DynamicVRAM partial-load `Linear.weight` failure.
- [x] Runtime TEST QA after CPU text-encoder placement reproduced the same `Linear.weight` failure, now directly inside node 374; CPU placement did not solve the missing text-projection weights.
- [x] LTX Voice full-checkpoint correction: restore the official ComfyUI architecture by using `ltx-2.3-22b-dev-fp8.safetensors` in `CheckpointLoaderSimple`, `LTXVAudioVAELoader`, and `LTXAVTextEncoderLoader`; remove the transformer-only `UNETLoader` plus separate video-VAE split from this voice workflow.
- [ ] Runtime TEST QA after full-checkpoint correction: queue a fresh `ltx` voice job and verify node 384 produces and uploads a playable MP3 without restarting ComfyUI.
- [x] Linux IndexTTS2 dataset worker installed in TEST: official IndexTTS2 source/model runtime, RTX 3090 shared GPU lock, ComfyUI idle/release gate, durable all-owner claim, resumable batch uploads, Linux status wording, systemd service, verification, and rollback. A real dataset job must still be verified before runtime completion is marked.
- [x] Linux Applio training worker installed in TEST: official Applio 3.6.2 runtime pinned to commit `c7be7282af0f7b6382cbb2ac780b11242da12916`, CUDA training prerequisites, durable all-owner `start_applio_training` claim, real IndexTTS2 manifest validation, RTX 3090 shared GPU lock, ComfyUI idle/release gate, preprocess/extract/train/index stages, verified `.pth` plus `.index` artifacts, systemd service, verification, and rollback. A real training job must still be verified before runtime completion is marked.

- [x] Linux Applio training hotfix: preserve the Applio `.venv/bin/python` symlink instead of resolving it to `/usr/bin/python3.12`; preprocess now runs inside the installed Applio environment with packages such as `tqdm` available. Real resumed training still requires runtime verification.

- [x] Linux Applio training hotfix: preserve the Applio `.venv/bin/python` symlink instead of resolving it to `/usr/bin/python3.12`; preprocess now runs inside the installed Applio environment with packages such as `tqdm` available.

- [x] Linux Applio training runtime verified in TEST on 2026-07-20: real 200-clip IndexTTS2 dataset, fast preset, 25 epochs, 122 seconds, and nonempty `.pth` plus `.index` artifacts for job `cvp_1784576536796_50de29114b11`.

- [x] Linux Applio inference and Character Preview Dub worker implementation added in TEST: all-owner durable claim, shared RTX 3090 voice GPU lock, ComfyUI idle/release gate, real Applio `.pth`/`.index` inference, offline guide speech, FFmpeg source-image preview generation, final audio/video stream validation, systemd services, verification, and rollback.

- [ ] Runtime verification: a real `test_trained_voice` job must complete with a nonempty WAV from `linux-applio-inference-worker`.

- [ ] Runtime verification: a real `generate_character_preview` job must complete with a playable nonempty `dubbed-preview.mp4` from `linux-character-preview-worker` before the Characters Test + Preview task is marked complete.

<!-- OTG_PRODUCTION_VIDEO_LORA_INVENTORY_PRIMARY_GATE_V1_START -->
## TEST Production video LoRA inventory and primary gate — 2026-07-25

- [x] Restore the Production Animate per-clip LoRA selector contract by implementing `/api/comfy/loras` with the existing cached ComfyUI video-LoRA inventory.
- [x] Prefer the RTX 3090 inventory and use the RTX 5060 Ti inventory only when the primary inventory is unavailable; never merge fallback-only filenames into a healthy primary list.
- [x] Return only safe relative ComfyUI LoRA filenames and reject absolute paths, traversal segments, control characters, and unsupported model extensions.
- [x] Permit a healthy RTX 3090 to attempt workflows marked `installed-not-tested` only when the capability manifest reports no missing nodes or models.
- [x] Keep RTX 5060 Ti fallback restricted to manifest-verified workflows with live validation and preserve original workflow settings with no automatic quality reduction.
- [x] Add focused contracts for the legacy inventory endpoint, safe filename filtering, fallback inventory selection, and installed-not-tested primary routing.
- [ ] Runtime TEST QA: open Production Animate and confirm the per-clip LoRA dropdown lists the RTX 3090 LoRA inventory without the former 404.
- [ ] Runtime TEST QA: submit `presets/Create a Video from Images` with the RTX 3090 online and confirm the request reaches the primary instead of being rejected by the stale verification gate.
- [ ] Runtime TEST QA: select one listed per-clip LoRA, submit a clip, and confirm the exact selected filename is applied successfully.
- [ ] PROD promotion requires explicit user approval after all runtime TEST checks pass.
<!-- OTG_PRODUCTION_VIDEO_LORA_INVENTORY_PRIMARY_GATE_V1_END -->

<!-- OTG_VIDEO_IMAGES_RUNTIME_BINDING_V1_START -->
## TEST Create a Video from Images runtime binding repair — 2026-07-26

- [x] Identify the stored workflow defect: the one-image Generate contract contained active `LoadImage` node `187` plus disconnected sample-image nodes `411` and `417` referencing `11177.webp`.
- [x] Remove the disconnected sample-image branch so the stored workflow and capability scan expose exactly one starter-image input.
- [x] Fail closed before Comfy submission unless the uploaded starter image is bound to node `187` and the three workflow-authored internal LoRA filenames still match their audited nodes.
- [x] Normalize safe `installed-not-tested` state spelling variants while continuing to reject any primary capability record with missing nodes or models.
- [x] Return auditable starter-image binding and selected Video LoRA application metadata in the TEST submission response.
- [x] Add focused contracts for one-image workflow hygiene, starter-image binding assertions, internal LoRA assertions, applied-LoRA response metadata, and primary-state normalization.
- [ ] Runtime TEST QA: rebuild and restart only `otg-test.service`, then submit `presets/Create a Video from Images` with one starter image and confirm node `187` contains the uploaded Comfy filename.
- [ ] Runtime TEST QA: confirm the healthy dependency-complete RTX 3090 accepts the request before any fallback decision.
- [ ] Runtime TEST QA: repeat with one selected Video LoRA and confirm `otgRequestDebug.videoLorasApplied` contains the inserted node and exact catalog selection.
- [ ] PROD promotion requires explicit user approval after all runtime TEST checks pass.
<!-- OTG_VIDEO_IMAGES_RUNTIME_BINDING_V1_END -->
- [x] Background Studio: resolve generated preview images by exact ComfyUI prompt id and filename prefix through dual-GPU history lookup; never substitute unrelated recent output.
- [x] Background Studio: hand off an exact prompt-scoped preview image to the configured Linux angle-plate backend and retrieve the stitched result by prompt id.
- [ ] Runtime verify Background Studio complete angle plate creation, preview display, and save behavior in TEST.
- [x] Background Studio: route angle-plate upload and prompt requests through the configured OTG angles backend instead of assuming loopback ComfyUI.
- [x] Background Studio: make completed-image saving transactional by awaiting the server POST and verifying the saved record through a fresh server library read.
- [ ] Runtime verify a completed background image saves, appears in the Background Library, and survives a TEST page refresh.
- [x] Background Studio: add a server-backed Saved Backgrounds manager with view, rename, refresh, and delete controls.
- [ ] Runtime verify saved backgrounds can be viewed, renamed, deleted, and remain correct after a TEST page refresh.
- [x] Background Studio: persist saved backgrounds under the active profile owner header, preserve establishing and angle-plate images separately, and reject metadata-only records.
- [ ] Runtime verify a newly saved background appears in Saved Backgrounds, survives refresh, and can be viewed, renamed, and deleted in TEST.
- [x] Saved Characters: route Linux absolute thumbnail paths through the guarded /api/file endpoint instead of rendering raw filesystem paths.
- [ ] Runtime verify the saved character bi thumbnail renders after a hard refresh in TEST.

<!-- OTG_PRODUCTION_VERTICAL_STACK_V1_START -->
## TEST Production tab vertical mobile layout — 2026-07-21

- [x] Keep the work scoped to the Production tab inside TEST; PROD deployment remains unchanged.
- [x] Replace horizontal Qwen scene rows with a single vertical scene stack.
- [x] Start a fresh Qwen scene builder with one scene and append scenes through a full-width `+ Add Scene` button up to the existing maximum of 8.
- [x] Migrate old eight-placeholder local state by trimming only unused trailing scene placeholders while preserving scenes containing input, prompt, reference, or result data.
- [x] Stack prompt passes, prompt actions, image references, asset controls, manual fields, picker results, stage controls, scene cards, and bottom navigation vertically.
- [x] Remove horizontal overflow from the Production pipeline shell and keep controls inside the viewport width.
- [ ] Runtime TEST QA: hard-refresh the Production tab on mobile and confirm only Scene 1 appears initially.
- [ ] Runtime TEST QA: press `+ Add Scene` repeatedly and confirm Scenes 2 through 8 appear underneath in order, with the button disabled at 8.
- [ ] Runtime TEST QA: confirm no Production storyboard control requires horizontal scrolling and prompt-pass generation behavior is unchanged.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_VERTICAL_STACK_V1_END -->

<!-- OTG_PRODUCTION_COMPACT_NAV_REFERENCE_UX_V1_START -->
## TEST Production Storyboard compact navigation and reference UX — 2026-07-21

- [x] Replace the oversized Production stage cards with one compact current-stage bar and four small square stage buttons on one horizontal row.
- [x] Rotate the four inactive stage buttons around the selected stage while retaining the five-stage order: Storyboard, Animate, Visual Edit, Audio Studio, Assemble.
- [x] Remove stage descriptions from the Production navigation controls and keep only stage number and name.
- [x] Keep the bottom Production stage selector as five compact named square buttons on one row.
- [x] Rename the Qwen scene input action to `Optional: Upload a completed scene`.
- [x] Scope Qwen character, background, and object gallery requests to the active profile owner.
- [x] Serve Linux absolute reference thumbnails through `/api/file` instead of treating them as browser-relative URLs.
- [x] Keep Character Gallery, Background Gallery, and Object / Prop Gallery as the primary reference controls.
- [x] Move the raw asset bridge fields under `Advanced: Add a manual image reference` with plain-language field explanations.
- [x] Clarify that Object / Prop Gallery adds an image reference and that text instructions belong in the Scene Prompt box.
- [ ] Runtime TEST QA: verify the four inactive stage squares remain on one line on mobile and rotate when the selected stage changes.
- [ ] Runtime TEST QA: verify the saved `bi` character appears and can be added through Character Gallery.
- [ ] Runtime TEST QA: verify Background Gallery still works and Object / Prop Gallery returns reusable image assets.
- [ ] Runtime TEST QA: verify adding references still enforces the three-image limit per prompt pass.

<!-- OTG_PRODUCTION_COMPACT_NAV_REFERENCE_UX_V1_END -->

<!-- OTG_PRODUCTION_PROFILE_CHARACTER_PROP_GALLERY_V2_START -->
## TEST Production Storyboard profile Character Gallery and regular Object / Prop Gallery — 2026-07-22

- [x] Keep saved-character access profile-isolated; do not expose another profile's characters to a Guest session.
- [x] Load Character Gallery directly from `/api/characters` for the signed-in profile and normalize the saved character preview plus workflow-card image fields.
- [x] Display a clear sign-in message instead of a misleading empty picker when the mobile browser is currently Guest.
- [x] Make Object / Prop Gallery load still images directly from the app's regular `/api/gallery` library.
- [x] Keep phone/device image upload unavailable from Object / Prop Gallery.
- [x] Keep the existing Background Gallery behavior and three-reference limit unchanged.
- [ ] Runtime TEST QA: sign in on mobile as the profile that owns `bi`, open Character Gallery, and add `bi` to a prompt pass.
- [ ] Runtime TEST QA: open Object / Prop Gallery, confirm the regular Gallery images appear, and add one as an object reference.
- [ ] Runtime TEST QA: confirm no phone upload control appears in Object / Prop Gallery and the three-reference limit remains enforced.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_PROFILE_CHARACTER_PROP_GALLERY_V2_END -->

<!-- OTG_PRODUCTION_SCENE_PASS_REFERENCE_STAGING_V1_START -->
## TEST Production Storyboard scene-pass reference staging — 2026-07-25

- [x] Preserve absolute Linux OTG image paths and app proxy URLs until the server stages each selected reference into the target ComfyUI input directory.
- [x] Resolve files directly from `OTG_DATA_ROOT` / `OTG_DATA_DIR` instead of searching only repository-local `data` folders.
- [x] Route Production scene-pass image workflows to the configured image backend, with the current TEST RTX 5060 Ti backend as the explicit fallback.
- [x] Upload selected character, background, and prop images through the target backend `/upload/image` endpoint and patch workflow `LoadImage` nodes with the returned input filename.
- [x] Add server logs recording the target backend, original source locator, and staged ComfyUI input filename for every reference.
- [ ] Runtime TEST QA: select `bi` plus a saved background, submit the prompt pass, and confirm all selected references stage successfully.
- [ ] Runtime TEST QA: verify the Qwen scene-pass prompt is accepted by the RTX 5060 Ti ComfyUI backend and returns a generated scene image.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_SCENE_PASS_REFERENCE_STAGING_V1_END -->

<!-- OTG_PRODUCTION_BACKGROUND_GALLERY_MOBILE_VIEWER_V1_START -->
## TEST Production Storyboard Background Gallery preview and mobile viewer — 2026-07-25

- [x] Load Background Gallery directly from the active profile `/api/backgrounds` records instead of the generic asset bridge/localStorage scan.
- [x] Use the establishing image as the visible gallery preview while retaining the stitched panorama/angle plate as the workflow reference.
- [x] Route Linux absolute preview paths through the guarded `/api/file` endpoint.
- [x] Show a clear preview-unavailable placeholder instead of a broken image element.
- [x] Add a dedicated mobile viewer with a sticky full-width close control, backdrop close, lower close button, and Escape-key close.
- [ ] Runtime TEST QA: verify the saved background preview renders in Storyboard Background Gallery.
- [ ] Runtime TEST QA: open and close the background viewer using the top button, lower button, and backdrop on mobile.
- [ ] Runtime TEST QA: add the background reference and confirm the workflow still uses the saved stitched image plate.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_BACKGROUND_GALLERY_MOBILE_VIEWER_V1_END -->

<!-- OTG_BACKGROUND_STABLE_ASSET_VIEWER_V36BPI1_START -->
## TEST Background Library stable image persistence and viewer repair — 2026-07-25

- [x] Persist generated background preview and panorama images into the owner-scoped TEST background asset directory instead of storing temporary Comfy history URLs as the permanent record.
- [x] Repair existing saved background records on `/api/backgrounds` load by retrieving the original Comfy output and writing stable `/api/file` display URLs plus absolute workflow image paths.
- [x] Keep the establishing image as the visible thumbnail/viewer image and the stitched panorama as the workflow reference.
- [x] Prioritize the panorama workflow image over the establishing image when normalizing saved background records.
- [x] Add Background Studio thumbnail fallbacks instead of rendering a broken image icon.
- [x] Add a sticky full-width close control, lower close control, backdrop close, Escape-key close, and body-scroll lock to the Background Studio saved-image viewer.
- [ ] Runtime TEST QA: refresh Saved Backgrounds and confirm `Scene Background` is migrated to owner-scoped stable asset files.
- [ ] Runtime TEST QA: confirm the Background Studio thumbnail and full viewer image render on desktop and mobile.
- [ ] Runtime TEST QA: confirm the same repaired establishing image renders in Production Storyboard Background Gallery.
- [ ] Runtime TEST QA: add the background to a scene and confirm the stitched panorama path is used for ComfyUI staging.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_BACKGROUND_STABLE_ASSET_VIEWER_V36BPI1_END -->

<!-- OTG_PRODUCTION_SCENE_BACKGROUND_EQUIP_V1_START -->
## TEST Production Storyboard equipped background preview and workflow inclusion — 2026-07-25

- [x] Show every equipped scene reference in a compact preview row directly above the prompt actions.
- [x] Highlight the equipped background with its preview image, name, and an explicit background-equipped label.
- [x] Rename the saved-background action to `Equip Background` and automatically close the picker after equipping it.
- [x] Replace the prior unlocked background when a different saved background is equipped instead of silently accumulating stale backgrounds.
- [x] Order submitted references as locked base, character, background, then object so a first-pass character plus background reaches Qwen as image 1 and image 2.
- [x] Return staged-reference and character/background inclusion metadata from the scene-pass route for runtime verification.
- [ ] Runtime TEST QA: equip `bi` and `Scene Background`; confirm both compact previews appear before Submit Prompt.
- [ ] Runtime TEST QA: submit Prompt 1 and confirm the response reports `includesCharacter: true`, `includesBackground: true`, and two staged references.
- [ ] Runtime TEST QA: confirm the generated scene uses the selected character and selected saved background.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_SCENE_BACKGROUND_EQUIP_V1_END -->

<!-- OTG_PRODUCTION_BACKGROUND_SELECTION_STRENGTHENING_V2_START -->
## TEST Production Storyboard definite background selection — 2026-07-25

- [x] Make the entire saved-background card and preview image equip the background with one tap; retain a separate `View Image` control.
- [x] Keep the Background Gallery open after selection and show a persistent green selected state, check badge, prompt number, and explicit `Done - Keep Selected Background` control.
- [x] Replace an existing unlocked background deterministically and reserve a slot for the selected background by removing a lower-priority unlocked object or extra reference when the three-image limit is full.
- [x] Keep Background Gallery accessible at 3/3 so the user can replace the current background or displace a lower-priority unlocked reference.
- [x] Require one character and one background before Submit Prompt or Redo Prompt can run.
- [x] Show the selected character and background names in the pre-submit confirmation.
- [ ] Runtime TEST QA: tap the background preview image and confirm the card turns green with `Selected for Prompt 1`.
- [ ] Runtime TEST QA: close the picker with `Done - Keep Selected Background` and confirm the compact equipped-background preview remains above the prompt.
- [ ] Runtime TEST QA: submit with `bi` plus `Scene Background` and confirm two references stage and reach Qwen in character/background order.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_BACKGROUND_SELECTION_STRENGTHENING_V2_END -->


<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V1_START -->
## TEST Production Storyboard Qwen background click routing — 2026-07-25

- [x] Mark the Qwen Scene Builder root and its Background Gallery button with dedicated data attributes.
- [x] Stop the legacy Storyboard document-level click interceptor from hijacking buttons inside Qwen Scene Builder.
- [x] Preserve the legacy background overlay only for older Storyboard controls outside Qwen Scene Builder.
- [x] Route Background Gallery clicks into Qwen React state so the selected background appears in the equipped-reference strip and reaches scene-pass submission.
- [ ] Runtime TEST QA: click Background Gallery and confirm the inline Qwen picker opens instead of the legacy modal overlay.
- [ ] Runtime TEST QA: equip `Scene Background` and confirm the green selected state plus compact equipped-background preview remain visible.
- [ ] Runtime TEST QA: submit with `bi` plus `Scene Background` and confirm two staged references reach Qwen.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V1_END -->


<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V2_START -->
## TEST Production Storyboard Qwen background click routing v2 attempt — 2026-07-25

- [x] Confirm v1 was installed, built, activated, and present in the active TEST JavaScript bundle.
- [x] Record v1 runtime failure: the obsolete centered Storyboard Background Gallery still opened and Prompt 1 stayed at `1/3`.
- [x] Disable registration of the global capture-phase legacy background interceptor whenever Qwen Scene Builder is mounted.
- [x] Add a second runtime guard so a previously registered legacy handler cannot act after Qwen mounts.
- [x] Preserve the legacy modal only when the Qwen Scene Builder is not present.
- [x] Record v2 installer failure: the new v2 contract passed, but the older routing contract counted only one of two equivalent Qwen button guards.
- [x] Confirm the v2 installer automatically restored TEST source and left PROD untouched.
- [x] Leave v2 runtime QA incomplete because the failed installer never activated v2.
- [ ] Runtime TEST QA: Background Gallery opens only the inline Qwen picker.
- [ ] Runtime TEST QA: selecting `Scene Background` changes Prompt 1 from `1/3` to `2/3` and shows the equipped background preview.
- [ ] Runtime TEST QA: submit `bi` plus `Scene Background` and confirm both references stage to ComfyUI.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V2_END -->


<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V3_START -->
## TEST Production Storyboard Qwen background click routing v3 — 2026-07-25

- [x] Preserve the v2 mount-time guard that prevents registration of the legacy capture-phase click interceptor while Qwen is mounted.
- [x] Preserve the v2 runtime document guard that blocks an already-registered handler if Qwen mounts later.
- [x] Restore the explicit literal Qwen button exclusion in both legacy handler paths so the older and v3 contracts verify the same behavior.
- [x] Keep the legacy Storyboard Background Gallery available only outside Qwen Scene Builder.
- [x] Require the installer to run the v3, original routing, and background-selection contracts before building or activating TEST.
- [ ] Runtime TEST QA: Background Gallery opens only the inline Qwen picker.
- [ ] Runtime TEST QA: selecting `Scene Background` changes Prompt 1 from `1/3` to `2/3` and shows the equipped background preview.
- [ ] Runtime TEST QA: submit `bi` plus `Scene Background` and confirm both references stage to ComfyUI.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_QWEN_BACKGROUND_CLICK_ROUTING_V3_END -->


<!-- OTG_PRODUCTION_QWEN_BACKGROUND_WORKFLOW_BINDING_V4_START -->
## TEST Production Storyboard Qwen background workflow binding v4 — 2026-07-25

- [x] Preserve the verified v3 inline Background Gallery click routing and equipped-reference state.
- [x] Trace the equipped background through scene-pass normalization, ComfyUI input staging, and the embedded Qwen workflow builder.
- [x] Confirm the server already stages the character and background as Qwen image 1 and image 2 in deterministic reference order.
- [x] Fix the embedded workflow builder so staged image 2 and image 3 connect to both the positive and negative Qwen conditioning encoders.
- [x] Reject the request before ComfyUI submission if a staged filename, positive encoder link, negative encoder link, or unused image slot is inconsistent.
- [x] Log and return `workflowImageBindings` metadata with the selected slot, type, staged filename, LoadImage node, and both encoder node IDs.
- [x] Add a focused contract that verifies symmetric image 1–3 binding and matches the supplied production Qwen workflow's positive/negative image contract.
- [ ] Runtime TEST QA: submit Prompt 1 with `bi` and `Scene Background`; confirm the response contains two `workflowImageBindings`.
- [ ] Runtime TEST QA: confirm the second binding is type `background`, uses LoadImage node `167`, and points to positive encoder `1` plus negative encoder `39`.
- [ ] Runtime TEST QA: confirm ComfyUI accepts the graph without a red/unbound background image socket and the generated scene uses the selected saved background.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_PRODUCTION_QWEN_BACKGROUND_WORKFLOW_BINDING_V4_END -->

- [x] OTG_VIDEO_IMAGES_EXPLICIT_PRESET_PRECEDENCE_MANUAL_V1 — TEST source now canonicalizes `presets/Create a Video from Images` and clears conflicting legacy `workflowFile`, `workflowPath`, `workflowJsonPath`, and `workflowPresetPath` values before graph selection. Regression coverage preserves node 187 for the explicit preset and node 149 for genuine production image-to-video requests.

- [x] OTG_VIDEO_PRIMARY_INSTALLED_NOT_TESTED_ATTEMPT_V2 - TEST permits the healthy RTX 3090 primary to attempt an `installed-not-tested` video workflow only when its capability record has no missing nodes or models. RTX 5060 Ti fallback remains restricted to verified workflows and no quality reduction is introduced.

- [x] OTG_VISUAL_EDIT_LORA_PATH_SEPARATOR_V1 — TEST Visual Edit now uses the exact Linux ComfyUI LoRA inventory value `ltxx/ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors` in both the canonical and production API workflow copies. The invalid Windows backslash value was removed; runtime output verification remains pending.

- [x] OTG_AUDIO_STUDIO_RUNTIME_DATA_ROOT_V1 — TEST Audio Studio Analyze Clip and Dub Preview now resolve source videos from the persistent `OTG_DATA_DIR`/`OTG_DATA_ROOT`, search the authenticated owner gallery first, retain configured/profile/Comfy/URL fallbacks, and no longer depend on release-local `process.cwd()/data`. Runtime Analyze Clip and Dub Preview verification remains pending.

- [x] OTG_CHARACTER_FULL_BODY_EDIT_IMAGE_MODEL_PATH_V2 - TEST Characters full-body completion now uses the exact RTX 3090 `UNETLoader` inventory value `qwen_image_edit_2509_fp8_e4m3fn.safetensors` in `presets/Edit Image`, updates only that workflow's RTX 3090 capability to dependency-complete `installed-not-tested`, and displays the real backend failure instead of the generic full-body error. Complete generated output verification remains pending.

- [x] OTG_CHARACTER_FULL_BODY_PRIMARY_ATTEMPT_GATE_V1 — TEST `presets/Edit Image` may now make one RTX 3090 primary attempt while its support state is `installed-not-tested`, but only when `missingNodes` and `missingModels` are both empty. RTX 5060 Ti remains blocked until verified, all other non-video workflows retain the existing verified-only policy, and duplicate full-body failure text was removed from the green status box. Complete generated output verification remains pending.

<!-- OTG_CHARACTER_TAB_REWORK_CURRENT_STABLE_PHASE1_START -->
## TEST Character Tab Rework — Current Stable Baseline Phase 1

- [x] Rebase Character redesign on the current stable `shawn:3001` development source instead of the older `slr` source.
- [x] Preserve the current 12,919-line `CharactersPanel.tsx` implementation unchanged as the Legacy Characters implementation.
- [x] Add a new light-blue user-facing Character hub.
- [x] Reuse `AppPageClient`'s existing admin state and expose `Legacy Characters — Admin` only to admins.
- [x] Add Character Gallery, Background Gallery, and Asset Gallery navigation.
- [x] Add Create Character, Create Freeform Character, Upload Character, and Upload Freeform Character entry screens.
- [x] Keep Phase 1 navigation/layout-only.
- [x] Keep Character voice redesign paused.
- [ ] Runtime TEST preview QA on the current-forward source.
- [ ] Manual Android/phone visual approval.
- [ ] Begin Create Character workflow only after Phase 1 visual approval.
- [ ] PROD promotion requires explicit user approval.

Detailed source-of-truth checklist: `docs/character-tab-rework-checklist.md`
<!-- OTG_CHARACTER_TAB_REWORK_CURRENT_STABLE_PHASE1_END -->

<!-- OTG_CHARACTER_MODEL_SELECTION_PHASE2_START -->
## TEST Character Model Selection — Phase 2

- [x] Add the same model catalog to Create Character and Create Freeform Character.
- [x] User-facing labels: Ernie Image, Z Image, Krea 2, Boogu, Mage Flow.
- [x] Map Ernie Image to `image_ernie_image_turbo.json`.
- [x] Map Z Image to `image_z_image_turbo.json`.
- [x] Map Krea 2 to `image_krea2_turbo_t2i.json`.
- [x] Map Boogu to `image_boogu_image_0_1_turbo_t2i.json`.
- [x] Map Mage Flow to `image_mage_flow_turbo_t2i_int8.json`.
- [x] Standard Create Character retains full-body humanoid/biped generation requirements.
- [x] Freeform Character uses the same models but removes standard anatomy restrictions.
- [x] Keep generation disabled until backend workflow routing is verified.
- [ ] Runtime TEST visual approval.
- [ ] Verify all five workflow dependencies on the selected ComfyUI backend.
- [ ] Wire real generation.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_CHARACTER_MODEL_SELECTION_PHASE2_END -->

<!-- OTG_CHARACTER_STYLE_PRESETS_PHASE3_START -->
## TEST Character Style Presets — Phase 3

- [x] Add shared style preset selector to Create Character.
- [x] Add shared style preset selector to Create Freeform Character.
- [x] Add style presets: Cartoon, Anime, 3D Pixar, Unreal Engine, Photorealistic, Cinematic.
- [x] Keep the same style catalog across both creation modes.
- [x] Fix output to portrait 1080 x 1920.
- [x] Document 9:16 aspect ratio in the UI.
- [x] Document random-seed behavior in the UI.
- [x] Keep generation disabled until backend routing is verified.
- [ ] Runtime TEST visual approval.
- [ ] Inject selected style preset into prompt construction.
- [ ] Force portrait 1080 x 1920 and random seed in the real generation route.
- [ ] PROD promotion requires explicit user approval.
<!-- OTG_CHARACTER_STYLE_PRESETS_PHASE3_END -->

<!-- OTG_CHARACTER_COMFY_CONNECTION_PHASE4_START -->
## TEST Character ComfyUI Connection — Phase 4

- [x] Dedicated Character generation route added; global `/api/comfy` pixel guard remains unchanged.
- [x] Five supplied Character Turbo workflows installed as exact source workflows.
- [x] Ernie Image / Z Image / Krea 2 / Boogu prefer the configured image ComfyUI backend.
- [x] Those four may preflight-fallback to local 3090 before submission only.
- [x] Mage Flow routes to local 3090 because the 5060 Ti inventory is incomplete for Mage.
- [x] No failover occurs after `/prompt` submission begins, preventing duplicate jobs on uncertain responses.
- [x] Final Character candidate output is fixed at portrait 1080 x 1920.
- [x] Server generates a fresh random seed for every request.
- [x] Server injects shared style presets and distinct standard/freeform anatomy contracts.
- [x] Temporary candidates use ComfyUI `PreviewImage` rather than normal gallery `SaveImage`.
- [x] Character UI can display up to five generated candidates.
- [ ] Runtime-test all five models.
- [ ] Verify exact 1080 x 1920 output for all five models.
- [ ] Wire candidate Continue / Save for Later / rejection cleanup.
- [ ] PROD promotion requires explicit user approval and explicit Character backend env configuration.
<!-- OTG_CHARACTER_COMFY_CONNECTION_PHASE4_END -->


<!-- OTG_CHARACTER_CANDIDATE_LIGHTBOX_PHASE5B_START -->
## TEST Character Candidate Expanded Preview — Phase 5b

- [x] Generated Character candidate images open an expanded lightbox on click/tap.
- [x] Expanded preview uses the full available viewport and `object-contain`.
- [x] Explicit Close and backdrop-close behavior are provided.
- [x] Candidate action buttons remain independent of image expansion.
- [x] Native image dragging is disabled.
- [x] Expanded viewer is portaled above the app stacking context and all normal fixed/sticky chrome.
- [x] Close control has its own higher layer, pointer events, a 48px minimum touch target, and mobile safe-area offsets.
- [x] Escape closes on desktop; backdrop taps outside the image close; image taps do not close.
- [ ] Runtime verification on TEST port 3003 pending.
<!-- OTG_CHARACTER_CANDIDATE_LIGHTBOX_PHASE5B_END -->

<!-- OTG_CHARACTER_CANDIDATE_ACTIONS_PHASE5D -->
## TEST Character Candidate Actions — Phase 5d Recovery

- [x] Recovered the partial Phase 5 state using staged writes.
- [x] Candidate actions: Modify, Select, Save for Later, Clear.
- [x] Selection is explicit.
- [x] Saved for Later is Character device-scoped and outside the normal Gallery.
- [x] Separate Saved for Later Character Gallery is wired.
- [x] Saved candidates return to Standard or Freeform Create.
- [x] Expanded candidate viewer remains active.
- [ ] Modify requires verified edit-image workflow.
- [ ] Selected candidate to Character Card handoff remains pending.
- [ ] Runtime persistence/reuse validation remains pending.
- [ ] PROD untouched.


<!-- OTG_CHARACTER_GALLERY_LAYOUT_PHASE5E -->
## TEST Character Gallery Layout — Phase 5e

- [x] Left column: Create Character, then Create Freeform Character.
- [x] Right column: Upload Character, then Upload Freeform Character.
- [x] Saved for Later moved beneath both columns.
- [x] No Character workflow behavior changed.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_SOFT_GENERATION_PROMPT_PHASE6 -->
## TEST Character Generation Prompt — Phase 6

- [x] Standard Character generation prompt softened.
- [x] Hard anatomy policing removed from generation prompt and UI.
- [x] Full-body/no-crop Character Card suitability retained.
- [x] Model/workflow/output routing unchanged.
- [ ] Runtime model quality comparison pending.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_SOFT_GENERATION_PROMPT_PHASE6B -->
## TEST Character Prompt Softening — Phase 6b

- [x] Active Standard Character backend prompt softened.
- [x] Visible Character Rules synchronized with backend behavior.
- [x] Fixed portrait output and workflow routing unchanged.
- [ ] Runtime model comparison pending.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_NO_EXTRA_PROMPT_RULES_PHASE6C -->
## TEST Character Prompt Rules — Phase 6c

- [x] Extra Character generation prompt rules removed.
- [x] Character Rules UI panel removed.
- [x] Generation now uses user description + selected style only.
- [x] Fixed output/model routing/random seed behavior preserved.
- [ ] Runtime model comparison pending.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_MAGE_5060_PRIMARY_PHASE7 -->
## TEST Character Mage Flow Routing — Phase 7

- [x] Mage Flow prefers RTX 5060 Ti image-primary.
- [x] RTX 3090 retained as preflight fallback.
- [x] Existing Mage node/model validation retained.
- [ ] Runtime 5060 Ti Mage generation verification pending.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_PROMPT_ENHANCE_PHASE8 -->
## TEST Character Prompt Enhance — Phase 8

- [x] Character Description has a Large `Enhance Prompt` action.
- [x] Dedicated Character description enhancement API used; general prompt enhancement remains unchanged.
- [x] Enhanced result remains editable before generation.
- [ ] Runtime verification pending on 3003.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_DESCRIPTION_ENHANCE_PHASE8B -->
## TEST Character Description Enhance — Phase 8b

- [x] Character enhancement is description-only.
- [x] Art Style removed from enhancement input/output contract.
- [x] Dedicated Character enhancement route added.
- [x] General cinematic prompt enhancer remains unchanged for other app features.
- [ ] Runtime verification pending on 3003.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_DESCRIPTION_ENHANCE_PHASE8C -->
## TEST Character Description Enhance — Phase 8c

- [x] Character enhancement now requires concrete details.
- [x] Generic fallback boilerplate removed.
- [x] Automatic second refinement pass added.
- [x] Art Style remains generation-only.
- [ ] Runtime quality verification pending on 3003.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_DESCRIPTION_PROVIDER_PHASE8D -->
## TEST Character Description Provider — Phase 8d

- [x] Character enhancement isolated from the existing heuristic provider.
- [x] Character enhancement defaults to Qwen2.5 3B.
- [x] Character-specific URL/model/timeout/keep-alive settings implemented with 45-second timeout default, 60-second cap, and 5-minute keep-alive.
- [x] Character prompt targets 5-8 concrete visual additions in 60-90 words while preserving body plan and excluding invented transformations, lore, art style, and scene direction.
- [x] Ollama installed and running on TEST host with `qwen2.5:3b` available.
- [ ] Runtime enhancement verification pending on 3003.
- [ ] PROD untouched.

<!-- OTG_CHARACTER_STANDARD_FULL_BODY_RULE_PHASE9C -->
## TEST Standard Character Full-Body Rule — Phase 9c

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
- [ ] PROD untouched.

<!-- OTG_STANDARD_GALLERY_3003_PARITY_PHASE10 -->
## Standard Gallery parity on 3003

Stable 3001 source audit: `otg-test.service` runs the standalone release at `/home/shawn-rochford/AI/deploy/otg-test/releases/character-full-body-primary-attempt-gate-v6-20260803T115936Z`, loads its worktree environment from `/home/shawn-rochford/AI/work/OTG-Test2`, and uses `/home/shawn-rochford/AI/runtime/test/data` through `OTG_DATA_ROOT`/`OTG_DATA_DIR`. The release Gallery components match the donor worktree byte-for-byte.

- [x] Active stable 3001 Gallery source identified.
- [x] Standard Gallery component parity restored.
- [x] ComfyUI Gallery synchronization restored.
- [x] Same Standard Gallery controls restored.
- [x] Same control labels/order/behavior restored.
- [x] Canonical scoped image URLs preserved.
- [x] Owner/device scoping preserved.
- [x] Mobile expanded viewer preserved.
- [x] Character candidates remain excluded from normal Gallery.
- [x] Gallery tests pass.
- [x] Character regressions pass.
- [x] TypeScript passes.
- [ ] Runtime verification on port 3003 pending.
- [x] PROD untouched.
- [x] Port 3001 untouched.

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

<!-- OTG_CHARACTER_CANDIDATE_EDIT_CARD_E003_PORT3003_START -->
## E003 — Character candidate Edit and Character Card on TEST port 3003 — 2026-08-09

- [x] Active port-3003 component confirmed as `CharacterHubPanel.tsx`; admin-only Legacy `CharactersPanel.tsx` was not used as the integration target.
- [x] Replaced the disconnected edit placeholder with the real E003 `Apply Edit` flow.
- [x] Candidate edits use `presets/Edit Image`, stable source `imageAPath`, LoadImage node `78`, Qwen nodes `433:111`/`433:110`, Lightning four-step/CFG 1 settings, and the verified Qwen Image Edit 2509 model/CLIP/VAE/LoRA contract.
- [x] Edited output is persisted to Character staging and appended with lineage without replacing the original candidate.
- [x] Modify, Select, Save for Later, Clear, and mobile-safe expansion remain separate actions.
- [x] Selected stable candidates expose `Continue to Character Card`.
- [x] Continue processes the selected image through background removal before entering the dedicated Character Card step.
- [x] Character Card uses `presets/character_card_8_angles_low_angle`, LoadImage node `25`, final master-sheet SaveImage node `439`, and explicit no-General-Gallery flags.
- [x] Back to Candidates preserves the candidates, current selection, processed source, and current card.
- [x] Default/profile paths remain bound to the processed single-character image; Character Card paths remain bound to the accepted master sheet.
- [x] Only the accepted 4-by-2 master sheet is supported. No individual cropped angle assets are claimed.
- [ ] Manually verify real ComfyUI candidate editing and Character Card generation in the port-3003 browser.
- [ ] Inspect identity consistency, exact views, background removal, and mobile touch behavior against real GPU output.
- [ ] PROD promotion remains out of scope.

### Separate TEST UI defect: mobile header/content overlap

- [ ] Severe mobile header/content overlap remains visible on the port-3003 TEST site and is tracked separately from E003.
- [ ] Re-check after the E003 source restart and hard refresh to rule out stale development chunks.
- [ ] Do not repair the overlap as part of this E003 merge; schedule a separate mobile layout pass if it remains reproducible.
<!-- OTG_CHARACTER_CANDIDATE_EDIT_CARD_E003_PORT3003_END -->

- [x] TEST Phase 9 - Television Anime Art Styles: top-level Anime reveals a secondary Default + 25 television-anime preset dropdown; Default preserves the existing Anime prompt, while alternate selections inject a separate descriptive visual-style prompt for both Create Character and Create Freeform Character.

- [x] Characters: persistent mobile generation jobs - Android Chrome background/suspend no longer loses Character image jobs; idempotent server submission + browser recovery survives lost fetch responses and restores completed candidates on return. <!-- OTG_CHARACTER_MOBILE_GENERATION_PERSISTENCE_PHASE10 -->

- [x] TEST Phase 11 - 3D Animation Art Styles: the existing Pixar 3D display label is generalized to 3D Animation while retaining its stable internal ID; selecting it reveals Default + 25 curated 3D-animation presets, each injected as a separate descriptive style prompt and persisted through the Phase 10 mobile durable-generation job contract.
- [x] TEST Phase 12 - Character Card execution graph optimized: preserved the fixed eight-view master-sheet contract while sharing repeated Qwen model/CLIP/VAE/LoRA preprocessing, using 0.32 MP full-body and 0.20 MP close-up generation tiers, and using the Multiple-Angles <sks> trigger.
- [ ] TEST Phase 12 runtime gate - verify a fresh-seed warm Character Card completes in <= 180 seconds (target 120-150 seconds) before declaring the performance SLO closed.
