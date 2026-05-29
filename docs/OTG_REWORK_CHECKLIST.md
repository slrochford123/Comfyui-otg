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
- Character builder draft state now persists locally and to the TEST server draft store, including current builder page, selected style, typed fields, Voice Lab page, active job state, and profile state. Drafts clear only through Start Over/reset or save completion.
- Character builder progression now persists locked-page state. After moving forward, completed Character Builder and Voice Lab pages are restored as locked after tab changes, app reloads, or browser/app close; earlier pages can only be changed by Start Over.
- Voice Lab dataset preparation and voice model training jobs now expose Stop and Resume controls. Stop marks the durable job as user-stopped; Resume requeues the same job so resumable dataset/training artifact logic can continue from durable state.
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
- [x] Added persisted character records for completed card-only characters with oiceStatus: "none" and hasCustomVoice: false.
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
