# Character Voice + Audio Studio Plan

This document is the web-app source of truth for the planned Character Voice and Audio Studio pipeline. It records the intended structure only; backend integrations for Qwen3, Cosy/CosyVoice, Applio, Demucs/source separation, and LTX dubbing are not complete in this pass.

## Completed local proof of concept

- Character image exists first and is used as the identity anchor.
- A base character voice sample can be created outside the web app with a local TTS pipeline.
- Voice FX experiments proved that a base sample can be altered after generation.
- Candidate advanced FX include monstrous, angelic, stutter, echo, electric, stone person, zombie, ghost, radio, robotic, distant voice, and whisper.
- Preview-video intent is proven at the workflow level: character image plus saved voice should produce a short character preview, then dub that preview with the saved voice.

## Web app sections

### Character

- Image: generate or upload the character identity image, then create the character card.
- Voice: choose Qwen3-TTS or Cosy/CosyVoice and generate candidate base samples.
- Voice FX: optionally transform the approved base sample with a preset or advanced controls.
- Training: generate 200 training clips, run Applio, and create model/index artifacts.
- Voice Test: play custom text through the trained voice before saving it to the character.
- Preview Video: generate an LTX 2.3 / v1.1 preview video and dub it with the saved character voice.

### Production

- Visual Edit: trim clips and plan visual fixes.
- Audio Studio: plan audio jobs after visual edits.
- Dub Existing Voice: choose a clip, choose a saved character voice, queue dubbing, and preview the result.
- Add New Voice / Off-screen Voice: choose a character or voice, enter spoken text, choose timing/placement, choose FX/depth, generate and mix into the clip, and preview the result.

## Data contracts added

- `CharacterVoiceProfile`
- `VoiceGeneratorProvider = "qwen3" | "cosy"`
- `VoiceFxPreset`
- `VoiceTrainingJob`
- `VoiceModelArtifact`
- `AudioStudioJob`
- `DubExistingVoiceJob`
- `AddVoiceJob`

## Placeholder service functions added

- `createVoiceSample`
- `applyVoiceFx`
- `generateVoiceDataset`
- `startApplioTraining`
- `testCharacterVoice`
- `generateCharacterPreviewVideo`
- `dubPreviewVideo`
- `dubExistingClipVoice`
- `addVoiceToClip`

These functions currently return queued placeholder results. They are contract anchors for future API/worker implementation, not live model calls.

## Backend jobs needed

- Qwen3-TTS voice sample generation.
- Cosy/CosyVoice sample generation.
- Voice FX processing for clean and stylized presets.
- Dataset generation for 200 approved training clips.
- Applio training orchestration.
- Model and index artifact registration.
- Character voice test playback.
- LTX 2.3 / v1.1 character preview video generation.
- Preview-video dubbing with the saved character voice.
- Production clip dubbing for existing performances.
- Add-voice generation, timing, depth, ducking, and final mixdown.

## Known risks

- Heavy FX can damage voice consistency for training if used as the main reference.
- Qwen3 and Cosy/CosyVoice may produce different sample timing, loudness, and character consistency.
- A 200-clip dataset needs job progress, retry, cancellation, and disk cleanup before it is safe for regular users.
- Applio model/index paths need durable ownership and character association rules.
- Preview-video dubbing depends on stable clip duration and source separation quality.
- Audio Studio needs clear conflict handling when multiple voices overlap in the same timing range.

## Current implementation status

- Deployment architecture is now defined as Linux control plane plus Windows execution worker. Linux hosts the app, durable job state, gallery/favorites/results, and planning UI. CPU/GPU generation, IndexTTS2 cloning, Applio training/inference, ComfyUI rendering, Blender/Hunyuan processing, ffmpeg audio/video work, and model-backed AI helpers must run on the main Windows PC worker. Set `OTG_CONTROL_PLANE_ONLY=1` on Linux hosts so local worker ticks do not execute heavy Voice Lab jobs.
- A generic worker contract foundation is implemented in `lib/jobs/workerJobContract.ts` with generic `/api/worker/jobs/claim`, `/api/worker/jobs/complete`, `/api/worker/jobs/fail`, and `/api/worker/artifacts/upload` endpoints. These routes reuse the existing durable job store and are the migration target for all heavy app features.
- `scripts/windows/otg-worker.ps1` and `scripts/windows/otg-worker.py` coordinate the current Windows adapters for IndexTTS2 dataset generation, Applio training, and Applio inference. The coordinator also passes `--device-id` through to child adapters and registers the optional Animate preview adapter slot. Existing character-specific worker endpoints remain for backward compatibility while the generic contract becomes the standard path.
- Animate Me preview requests now create `character_animation_preview` / `animate_preview` jobs with prefix `cap`. The HTTP route performs only image, character, voice reference, and prompt validation, then returns HTTP 202 for the Windows worker to run ComfyUI, Seed-VC, and final muxing.
- `otg-local-execution-audit.txt` records the current server-local execution audit. Remaining local execution points must be converted in priority order: Characters/Voice Lab first, then Production, Edit Video/Audio Studio, Image/Video/3D/Angles/Storyboard, and model-backed AI helpers.
- Character UI shows the Image, Voice, Voice FX, Training, Voice Test, and Preview Video skeleton.
- Character UI has provider selection for Qwen3-TTS and Cosy/CosyVoice.
- Character Builder Voice Lab is split into four internal pages: Voice Design, Voice FX, Training, and Test + Preview.
- The Voice Lab internal page state is preserved in the builder autosave draft.
- Production navigation is split into Visual Edit and Audio Studio.
- Audio Studio shows Dub Existing Voice and Add New Voice / Off-screen Voice queued-job skeletons.
- API/job contract stubs are implemented for `POST /api/characters/voice-pipeline`, `GET /api/characters/voice-pipeline/[jobId]`, `POST /api/production/audio-studio`, and `GET /api/production/audio-studio/[jobId]`.
- The stub endpoints validate action names, required `characterId` / `clipId`, provider values, voice FX presets, and training presets, then return queued job records.
- Frontend API wiring is implemented for the Character Voice Pipeline and Production Audio Studio skeletons. UI actions now submit queued jobs, poll the matching GET endpoints, and show user-facing queued/running/completed/failed states.
- Durable local job persistence is implemented for queued Character Voice Pipeline and Production Audio Studio contract records.
- A no-op local worker runner is implemented for development. It advances persisted jobs through queued, running, progress updates, and completed states with deterministic mock result objects only.
- Voice Design Create Voice now supersedes older queued/running `create_voice_sample` jobs for the same owner and character, so stale abandoned requests do not block the latest active base voice request.
- In local dev/test only, Voice Lab can tick the existing dev worker endpoint for the active job id after Create Voice, Voice FX, Training, Test Playback, Preview, or Dub requests so status bars and mock/real local results advance without an old queued FIFO backlog blocking the current UI job. Production still requires a real durable worker/daemon.
- Qwen3 Voice Design now uses a structured Voice Model Designer. The UI builds a self-contained `voiceInstruction` from gender, age range, pitch, resonance/weight, tone, pace, accent/language, emotion baseline, articulation, avoid list, and optional notes, while keeping `sampleText` separate from voice identity.
- Voice Design now uses `lib/characters/voiceDesignModels.ts` as the source of truth for Qwen3-TTS and CosyVoice model modes, official preset/dialect lists, prompt-based accent guidance, and model-specific prompt builders. Qwen3-TTS VoiceDesign produces a natural-language `instruct` prompt, Qwen3-TTS CustomVoice exposes the documented preset speakers, and CosyVoice produces `<|endofprompt|>` instruction prompts with documented Chinese dialect phrases where applicable.
- Prompt-based English accent guidance is labeled separately from officially documented options. The UI recommends matching reference audio for British, Australian, Irish, Scottish, African English, Indian English, and similar prompt-guided accents rather than guaranteeing perfect accent accuracy.
- Voice Lab pages now share user-facing status/progress panels for create voice, Voice FX, dataset generation, Applio artifact creation, test playback, preview video, and preview dub jobs. Raw worker messages are kept in technical details instead of the primary status line.
- Saved character cards now expose the existing narrow character delete route through a confirmation-gated Delete button.
- Uploaded/reference voice samples are supported through `POST /api/characters/voice-sample/upload`. Uploads are stored under `OTG_DATA_DIR/characters/<ownerKey>/voice-samples/<characterId>/<uploadedId>/sample.<ext>` and become `characterVoiceProfile.provider: "uploaded"` base samples without requiring Qwen3 or Cosy/CosyVoice environment setup.
- Completed mock `create_voice_sample` results are visibly labeled as mock output and do not silently unlock Voice FX/Training as a normal real base voice unless `NEXT_PUBLIC_OTG_ALLOW_MOCK_VOICE_TRAINING=1` is set for dev/test.
- Completed mock `create_voice_sample` results can now persist to a saved character as `characterVoiceProfile` with `sample_ready` status, or remain in builder state until the character is saved.
- Completed mock Production Audio Studio results are persisted through a narrow owner-scoped clip result store and merged onto matching local storyboard `frameClips[].audioStudioResult` records with `mock_ready` status.
- Real Qwen3 base voice sample generation is available behind `OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE=1` for Character Voice `create_voice_sample` jobs with provider `qwen3`.
- Real Cosy/CosyVoice base voice sample generation has a worker adapter contract behind `OTG_ENABLE_REAL_COSY_VOICE_SAMPLE=1` for Character Voice `create_voice_sample` jobs with provider `cosy`.
- Real CosyVoice3 base voice sample generation has been proven through the local worker using `scripts/cosy_voice_sample_bridge.py`.
- Real Voice FX processing is available behind `OTG_ENABLE_REAL_VOICE_FX=1` for Character Voice `apply_voice_fx` jobs.
- Completed `apply_voice_fx` results now persist tuned sample metadata onto `characterVoiceProfile` as `tunedSampleUrl`, `tunedSamplePath`, `tunedFxPreset`, `tunedSourceJobId`, `tunedAt`, and `tunedResult`. The base sample is preserved, and `approvedSampleUrl` changes to the tuned sample only when the user chooses Use Tuned.
- Training and dataset queue contracts now use `characterVoiceProfile.approvedSampleUrl` as the canonical voice source. `generate_training_dataset` and `start_applio_training` reject requests without `approvedSampleUrl`, and the Training page shows whether the approved source is base, tuned, or unknown before queueing.
- `generate_training_dataset` now writes a durable voice pack at `OTG_DATA_DIR/characters/<ownerKey>/training-datasets/<characterId>/<jobId>/`. By default it generates unique utterance text and uses the selected Qwen3 or Cosy worker adapter to synthesize each clip, then normalizes each clip to mono `pcm_s16le` WAV at `APPLIO_SAMPLE_RATE` or 40000 Hz. The copy-based no-op voice pack is retained only when `OTG_ALLOW_MOCK_VOICE_PACK=1`. Real Applio training still does not run.
- Voice-pack manifests record `generationMode`, provider, source provenance, canonical source path/URL, generated clip count, started/completed timestamps, and per-clip utterance text. Clips are marked `ready` only after the WAV exists, and `/api/characters/training-dataset/file` serves both `clip_###.wav` and `source/source.wav`.
- Real voice-pack generation is resumable. The worker updates the manifest after each clip, records per-clip `pending` / `generating` / `ready` / `failed` status, skips valid ready clips on resume, retries failed clips up to the configured retry limit, and leaves incomplete packs runnable by the next worker invocation instead of discarding progress.
- `VOICE_PACK_CHUNK_SIZE` controls how many real clips a single worker run attempts, defaulting to 10. This reduces the blast radius of native Qwen3/Cosy failures while preserving completed clips. A persistent/batch bridge remains a future optimization.
- Real packs are only marked `voice_pack_ready` when all requested clips are ready, every file exists with bytes, and the generated clips are not all byte-identical.
- Cosy dataset generation now has a batch bridge at `scripts/index_tts2_clone_pack_bridge.py`. For provider `cosy`, one worker run sends up to `VOICE_PACK_CHUNK_SIZE` clips to one Python process, which loads CosyVoice once and writes raw clip outputs for the TypeScript worker to normalize into `clips/clip_###.wav`.
- The batch bridge path can be overridden with `COSYVOICE_BATCH_BRIDGE`; otherwise it is resolved beside `COSYVOICE_BRIDGE`.
- `start_applio_training` now consumes a dataset manifest and writes a durable no-op artifact at `OTG_DATA_DIR/characters/<ownerKey>/applio-models/<characterId>/<jobId>/training-artifact.json`. The artifact records the manifest path, approved sample URL, clip count, and expected model/index/config paths with `model.status: "not_trained"`; no real Applio process runs.
- Completed `start_applio_training` jobs now persist the no-op artifact metadata back onto the current character voice profile as `voiceModelArtifactId`, `voiceModelArtifacts[]`, `trainingArtifactPath`, `datasetManifestPath`, `modelPath`, and `indexPath`. Voice Model Status reads ready only after this profile persistence step succeeds.
- Real Applio training is now feature-gated behind `OTG_ENABLE_REAL_APPLIO_TRAINING=1`. The worker rejects mock/copy or incomplete packs, requires 200 ready real WAV clips, prepares an Applio dataset copy, runs the configured local Applio `core.py` CLI, writes logs under the character artifact folder, and only marks the job trained after verified `.pth` and `.index` outputs exist.
- Completed real Applio training artifacts now hydrate into `characterVoiceProfile` through the same narrow voice-profile update path used by base samples and tuned samples. Real trained profiles store `status:"trained"`, `trainingAdapter:"applio_real_training"`, `trainingMock:false`, `sourceTrainingJobId`, `voiceModelArtifactId`, `voiceModelArtifacts[]`, `trainingArtifactPath`, `trainingArtifactUrl`, `datasetManifestPath`, `datasetManifestUrl`, `modelPath`, and `indexPath`.
- Voice Lab now exposes Applio training quality presets near Train Voice Model: Fast (`25` epochs / save every `5`, `20-40 minutes`), Normal (`100` / `10`, `45-90 minutes`, default), and Quality (`200` / `10`, `90-180+ minutes`). The selected preset is queued with `start_applio_training`, and real Applio training uses job-provided `epochs` / `saveEveryEpoch` before env fallbacks.
- `start_applio_training` records durable stage/timer metadata while running (`currentStage`, stage start, elapsed labels, epoch progress when available) and records completion/failure durations into the final job result and persisted voice model artifact.
- Character creation and `update_voice_profile` validate trained Applio artifacts before saving. A real trained profile is not written unless the referenced `.pth` and `.index` files both exist with bytes.
- Voice Lab reloads can reconcile completed `start_applio_training` jobs from the durable voice-pipeline job store, so a local worker completion can still update the active builder profile after refresh.
- Voice Lab reloads now also recover validated real training artifacts from durable `training-artifact.json` files under `data/characters/<ownerKey>/applio-models/<characterId>/<jobId>/` when saved/builder profile state and the job store do not already expose the artifact. Recovery hydrates `voiceModelArtifactId`, `voiceModelArtifacts[]`, `trainingArtifactPath`, dataset paths, model/index paths, training timing fields, and real training flags only after checking non-empty `.pth` and `.index` files.
- Manual TEST proof persists the real trained `voice-training-8` artifact into saved character JSON at `data/characters/slrochford12300/voice-training-8.json`, then queues `test_trained_voice` from that saved profile. The proof output is served through `/api/characters/applio-inference/file` as `audio/wav` and has a different SHA256 hash from the input sample.
- TEST owner aliasing is enabled through `OTG_OWNER_ALIASES`; local `.env.local` maps `slrochford:slrochford12300` so browser login as `slrochford` reads the existing trained Voice Lab data under `data/characters/slrochford12300`.
- Trained Applio playback is now a distinct `test_trained_voice` Voice Lab action. It requires a real persisted Applio artifact (`mock:false`, `adapter:"applio_real_training"`) and verified non-empty `.pth` / `.index` files, then runs Applio `core.py infer` from `cwd=APPLIO_ROOT` using the approved local source sample as conversion input. For this local Applio install, use `APPLIO_INFER_SCRIPT=C:/AI/Voices/Applio/core.py`; the older `infer.py` path is not present, though the adapter still falls back to `core.py` when possible.
- Inference output is written to `OTG_DATA_DIR/characters/<ownerKey>/applio-inference/<characterId>/<jobId>/output.wav`, served through `/api/characters/applio-inference/file`, and rejected if missing, empty, traceback-bearing, or byte-identical to the input sample.
- Real Applio subprocesses run from `cwd=APPLIO_ROOT`. Preprocess includes `--cut_preprocess` with `APPLIO_CUT_PREPROCESS=Skip` by default; allowed values are `Skip`, `Simple`, and `Automatic`. Extract includes `--include_mutes` with `APPLIO_INCLUDE_MUTES=2` by default; allowed values are integers from `0` through `10`.
- Extract also includes `--cpu_cores` with `APPLIO_EXTRACT_CPU_CORES=8` by default on this worker; allowed values are integers from `1` through `64`.
- Applio stderr tracebacks and `ValueError:` messages are treated as stage failures even when `core.py` exits with code `0`.
- After extract, the worker requires `APPLIO_ROOT/logs/<modelName>/config.json`, non-empty `filelist.txt`, and extracted feature folders to exist before train starts.
- Real Applio train does not pass `--pitch_guidance` because the installed Applio `core.py train` CLI rejects that argument. `APPLIO_PITCH_GUIDANCE` is harmless if present in local env files, but the worker does not forward it.
- Real Applio train passes checkpoint/export flags supported by this installed CLI: `--save_every_weights` from `APPLIO_SAVE_EVERY_WEIGHTS=True`, `--save_only_latest` from `APPLIO_SAVE_ONLY_LATEST=False`, `--pretrained` from `APPLIO_PRETRAINED=True`, `--custom_pretrained` from `APPLIO_CUSTOM_PRETRAINED=False`, and `--vocoder` from `APPLIO_VOCODER=HiFi-GAN`. Optional `APPLIO_G_PRETRAINED_PATH` and `APPLIO_D_PRETRAINED_PATH` are forwarded only for custom pretrained mode after path validation.
- The worker validates Applio prerequisites before real training. For `APPLIO_F0_METHOD=rmvpe`, `APPLIO_ROOT/rvc/models/predictors/rmvpe.pt` is required. With default pretrained mode enabled, the selected vocoder checkpoints such as `rvc/models/pretraineds/hifi-gan/f0G40k.pth` and `f0D40k.pth` are required.
- Source inspection confirmed `core.py train` is the installed CLI entrypoint and calls `rvc/train/train.py` before index generation. Because child-process failures can still leave `core.py` generating an index, the worker now fails index-only train output that lacks epoch/training evidence with `Applio train produced index only; model training did not run.`
- After train, the worker searches `APPLIO_ROOT/assets/weights`, `APPLIO_ROOT/logs/<modelName>`, `APPLIO_ROOT/logs`, `APPLIO_MODELS_ROOT`, and the OTG artifact job root for non-empty `.pth` and `.index` files, preferring files whose name/path includes the exact model name. Selected outputs are copied into the character artifact folder and source paths are recorded in `training-artifact.json`.
- Current Applio proof status: preprocess, extract, and train can exit `0`, but the latest local run produced only an `.index` because extract left no usable F0/filelist training inputs. The installed checkout is missing at least `rvc/models/predictors/rmvpe.pt`; default pretrained HiFi-GAN checkpoints must also be installed or explicitly disabled/custom-provided before a real `.pth` can be expected.
- All other voice/audio/video actions still use the no-op mock worker path.

## Local job store

- The Character Voice Pipeline and Production Audio Studio contract routes store job records in `OTG_DATA_DIR/voice-pipeline-jobs.json`.
- If `OTG_DATA_DIR` is not set, local development uses `<repo>/data/voice-pipeline-jobs.json`.
- The file is local/dev persistence and is ignored through the existing `data/` gitignore rule.
- Writes use a temp file followed by rename. Missing or corrupt store files are treated as an empty job list so the API does not leak stack traces.

## No-op worker runner

- `POST /api/dev/voice-pipeline-worker/tick` advances the current owner/device queue by one deterministic lifecycle step per matching job.
- `GET /api/dev/voice-pipeline-worker/jobs` lists the current owner/device jobs for debugging.
- Both dev endpoints return 404 when `NODE_ENV === "production"`.
- The no-op worker does not create assets. Mock URLs point at `/mock-assets/...` or `/mock-artifacts/...` only so the UI can prove status/result handling before real processors are attached.

## Qwen3 voice sample adapter

- The worker can run real Qwen3-TTS VoiceDesign generation only for `character_voice_pipeline` jobs where `action` is `create_voice_sample` and `provider` is `qwen3`.
- Qwen3 jobs prefer the explicit `input.voiceInstruction` over legacy `qwenVoiceDesignRecord` fields. The sample phrase is passed separately as `sampleText`/`previewText`, so scene text and stale candidate instructions do not leak into the voice identity prompt.
- The worker params JSON records `voice_instruction`, `qwen_instruction`, `sample_text`, `preview_text`, and the structured `voice_design` object for debugging.
- Real generation is disabled by default. Enable it with `OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE=1`.
- The adapter uses the existing `scripts/qwen3_voice_design_preview.py` bridge and these environment variables: `QWEN_TTS_ROOT`, `QWEN_TTS_PYTHON`, `QWEN_TTS_SITE_PACKAGES`, `QWEN_TTS_BRIDGE`, `QWEN_TTS_MODEL_ID`, and `QWEN_TTS_PREVIEW_TIMEOUT_MS`.
- Generated WAV files are written under `OTG_DATA_DIR/characters/<ownerKey>/voice-samples/<characterId>/<jobId>/sample.wav`.
- Real results include `samplePath`, `sampleUrl`, `outputDir`, `logsPath`, `paramsPath`, `stdoutPath`, `stderrPath`, `provider: "qwen3"`, `adapter: "qwen3"`, and `mock: false`.
- If real Qwen3 is enabled but required paths are missing, the worker marks the job failed with a clear path-specific error instead of returning a mock success.
- Real Qwen3 jobs now write diagnostic job messages for adapter selection, resolved root/python/bridge paths, output directory, params path, log paths, process start, process exit, final sample path, or failure reason.
- Real Qwen3 generation should be run through `npm run voice-worker:once -- --limit 1` for manual proof instead of relying on browser-triggered dev ticks for long-running model work.

### Manual Qwen3 verification

PowerShell setup:

```powershell
$env:OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE = "1"
$env:QWEN_TTS_ROOT = "C:\AI\voices\qwen 3"
$env:QWEN_TTS_PYTHON = "C:\Users\SLRoc\miniconda3\envs\qwen3tts-repair\python.exe"
$env:QWEN_TTS_SITE_PACKAGES = "C:\AI\voices\qwen 3\qwen3tts-env\Lib\site-packages"
$env:QWEN_TTS_BRIDGE = "C:\AI\OTG-Test2\scripts\qwen3_voice_design_preview.py"
$env:QWEN_TTS_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
$env:QWEN_TTS_PREVIEW_TIMEOUT_MS = "600000"
npm run dev -- -p 3001
```

In a second PowerShell with the same environment values:

```powershell
npm run voice-worker:once -- --limit 1
Get-ChildItem C:\AI\OTG-Test2\data\characters -Recurse -Filter sample.wav |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName, Length, LastWriteTime
```

Expected proof:

- The newest `sample.wav` has `Length > 0`.
- The job result has `mock: false`, `adapter: "qwen3"`, `provider: "qwen3"`, `samplePath`, and `outputBytes > 0`.

## Cosy/CosyVoice voice sample adapter

- The worker can run real Cosy/CosyVoice generation only for `character_voice_pipeline` jobs where `action` is `create_voice_sample` and `provider` is `cosy`.
- Real generation is disabled by default. Enable it with `OTG_ENABLE_REAL_COSY_VOICE_SAMPLE=1`.
- No prior Cosy/CosyVoice bridge script or route was found in this repo during implementation.
- The local bridge entrypoint is `scripts/cosy_voice_sample_bridge.py`. It accepts `--params-json`, `--stdout-log`, and `--stderr-log`, writes structured JSON logs, and runs the proven CosyVoice3 API: `AutoModel(model_dir=...)` followed by `model.inference_instruct2(text, instruction, prompt_wav, stream=False)`.
- The adapter uses these environment variables: `COSYVOICE_ROOT`, `COSYVOICE_PYTHON`, optional `COSYVOICE_SITE_PACKAGES`, `COSYVOICE_BRIDGE`, `COSYVOICE_MODEL_ID`, and `COSYVOICE_TIMEOUT_MS`.
- The proven local manual values are `COSYVOICE_ROOT=C:\AI\Voices\cosyvoice`, `COSYVOICE_PYTHON=C:\Users\SLRoc\miniconda3\envs\voices-cosy\python.exe`, `COSYVOICE_MODEL_ID=Fun-CosyVoice3-0.5B`, and `COSYVOICE_BRIDGE=C:\AI\OTG-Test2\scripts\cosy_voice_sample_bridge.py`.
- `COSYVOICE_MODEL_ID` can be an absolute model path or a model folder name relative to `COSYVOICE_ROOT/pretrained_models`.
- `prompt_wav` can be supplied in params; otherwise the bridge uses `COSYVOICE_ROOT/asset/zero_shot_prompt.wav`.
- Generated WAV files are written under `OTG_DATA_DIR/characters/<ownerKey>/voice-samples/<characterId>/<jobId>/sample.wav`.
- Real results include `samplePath`, `sampleUrl`, `outputDir`, `logsPath`, `paramsPath`, `stdoutPath`, `stderrPath`, `provider: "cosy"`, `adapter: "cosy"`, `exitCode`, `outputBytes`, and `mock: false`.
- If real Cosy/CosyVoice is enabled but required environment values or paths are missing, the worker marks the job failed with a clear error instead of returning a mock success.
- The default instruction is: `You are a helpful assistant. Speak in English with a natural, clean, character voice. Preserve intelligibility and realistic pacing.<|endofprompt|>`.
- Normal mode never writes a dummy WAV.
- Bridge-only test mode exists through `COSYVOICE_BRIDGE_TEST_MODE=success`; it writes a small deterministic WAV only for local bridge verification and should not be used as a real generation path.
- Provider `cosy` continues to use the existing no-op mock lifecycle when `OTG_ENABLE_REAL_COSY_VOICE_SAMPLE` is not set.
- Real Cosy/CosyVoice generation should be run through `npm run voice-worker:once -- --owner <ownerKey> --limit 1` for manual proof instead of relying on browser-triggered dev ticks for long-running model work.

### Manual Cosy/CosyVoice verification

Mock fallback proof:

```powershell
npm run dev -- -p 3001
npm run voice-worker:once -- --owner slrochford12300 --limit 1
```

Real proof with the proven local CosyVoice3 paths:

```powershell
$env:OTG_ENABLE_REAL_COSY_VOICE_SAMPLE = "1"
$env:COSYVOICE_ROOT = "C:\AI\Voices\cosyvoice"
$env:COSYVOICE_PYTHON = "C:\Users\SLRoc\miniconda3\envs\voices-cosy\python.exe"
$env:COSYVOICE_SITE_PACKAGES = ""
$env:COSYVOICE_BRIDGE = "C:\AI\OTG-Test2\scripts\cosy_voice_sample_bridge.py"
$env:COSYVOICE_MODEL_ID = "Fun-CosyVoice3-0.5B"
$env:COSYVOICE_TIMEOUT_MS = "600000"
npm run dev -- -p 3001
```

In a second PowerShell with the same environment values:

```powershell
npm run voice-worker:once -- --owner slrochford12300 --limit 1
Get-ChildItem C:\AI\OTG-Test2\data\characters -Recurse -Filter sample.wav |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName, Length, LastWriteTime
```

Expected real proof:

- The newest `sample.wav` has `Length > 0`.
- The job result has `mock: false`, `adapter: "cosy"`, `provider: "cosy"`, `samplePath`, a `/api/characters/voice-sample/file` `sampleUrl`, and `outputBytes > 0`.
- Verified worker proof: job `cvp_1779737697433_a3b47ad60998` completed with `outputBytes: 1117520`; `ffprobe` reported a 24 kHz mono WAV, and the sample serving route returned `200 OK` with `content-type: audio/wav`.

Expected failure when a real Cosy dependency/API/model is not installed or not fully wired:

- The job reaches `status: "failed"` and `progress: 100`.
- The error names the missing CosyVoice dependency/API/model or missing generation conditioning inputs.
- `cosy_sample_stdout.log` and `cosy_sample_stderr.log` exist under the job `logs` directory.

## Voice FX adapter

- The worker can run real deterministic Voice FX only for `character_voice_pipeline` jobs where `action` is `apply_voice_fx`.
- Real FX is disabled by default. Enable it with `OTG_ENABLE_REAL_VOICE_FX=1`.
- The adapter uses `VOICE_FX_FFMPEG`, falling back to `FFMPEG_PATH`, then `ffmpeg` on `PATH`.
- `VOICE_FX_TIMEOUT_MS` controls the worker timeout and defaults to five minutes.
- The adapter resolves the source WAV from `inputPath`, `sourceSamplePath`, a `/api/characters/voice-sample/file` sample URL, or `sourceJobId`.
- Processed output is written to `OTG_DATA_DIR/characters/<ownerKey>/voice-samples/<characterId>/<jobId>/fx.wav`.
- The voice sample serving route supports `file=sample.wav`, `file=fx.wav`, and uploaded sample names `sample.mp3`, `sample.m4a`, `sample.flac`, and `sample.ogg`; it rejects all other file names.
- Real results include `mock: false`, `adapter: "voice_fx"`, `fxPreset`, `sourceSamplePath`, `processedSamplePath`, `processedSampleUrl`, `outputDir`, `logsPath`, `paramsPath`, `stdoutPath`, `stderrPath`, `exitCode`, and `outputBytes`.
- Initial supported ffmpeg filters cover mono conversion, gain, high-pass, low-pass, speed, optional pitch shift, and loudness normalization. Advanced stylization presets still need dedicated DSP design.
- If the input sample or ffmpeg executable is missing, the worker marks the job failed with a clear error instead of returning a mock success.

### Manual Voice FX verification

PowerShell setup:

```powershell
$env:OTG_ENABLE_REAL_VOICE_FX = "1"
$env:VOICE_FX_FFMPEG = "ffmpeg"
$env:VOICE_FX_TIMEOUT_MS = "300000"
npm run dev -- -p 3001
```

Queue Voice FX from `Characters -> Voice Lab -> Voice FX`, then run:

```powershell
npm run voice-worker:once -- --owner slrochford12300 --limit 1
Get-ChildItem C:\AI\OTG-Test2\data\characters -Recurse -Filter fx.wav |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName, Length, LastWriteTime
```

Expected proof:

- The newest `fx.wav` has `Length > 0`.
- The job result has `mock: false`, `adapter: "voice_fx"`, `processedSamplePath`, `processedSampleUrl` with `file=fx.wav`, and `outputBytes > 0`.

## Audio Studio mock result retention

- Completed Production Audio Studio mock results are stored in the active StoryboardPanel scene draft under the matching frame clip and persisted to `OTG_DATA_DIR/production-audio-studio-results.json`.
- If `OTG_DATA_DIR` is not set, local development uses `<repo>/data/production-audio-studio-results.json`.
- The store is intentionally narrow: it is keyed by owner and `clipId`, and it persists only `audioStudioResult` records.
- The older `lib/production/store.ts` shape does not match the current StoryboardPanel frame-clip manifest, so a broad server-side production model was not introduced in this pass.
- This remains mock-only. No real dubbing, mixing, source separation, FFmpeg, or model execution is connected.

## Next backend integration tasks

- Keep the no-op Applio artifact persistence stable through browser QA and reload checks.
- Manually verify the real Qwen3 adapter on the local Qwen3 environment using `npm run voice-worker:once -- --limit 1`.
- Promote the narrow clip result index into the canonical storyboard/clip store when the full frame-clip schema is stabilized.
- Replace the local JSON store with persistent production queue infrastructure when ready.
- Manually verify the feature-flagged Voice FX adapter against a Qwen3 or CosyVoice3 base sample.
- Install or configure the missing Applio predictor/pretrained assets, then rerun the first real `OTG_ENABLE_REAL_APPLIO_TRAINING=1` proof against the verified Qwen3 voice pack.
- Add real LTX preview and preview-dub adapters.
- Add Production Audio Studio render adapters for Demucs/source separation, voice conversion, mix preview, and final render.

---

## Verified no-op lifecycle - 2026-05-25

Status: COMPLETE for orchestration lifecycle.

Verified manually in TEST:

- Character Voice job queue route works.
- Production Audio Studio job queue route works.
- Durable local job persistence works.
- Dev worker tick route works.
- Character Voice job completed through:
  queued -> running 5 -> running 35 -> running 70 -> completed 100
- Audio Studio job completed through:
  queued -> running 5 -> running 35 -> running 70 -> completed 100
- Mock Character Voice result returned:
  /mock-assets/voices/{jobId}/sample.wav
- Mock Audio Studio result returned:
  /mock-assets/clips/{jobId}/voice-added.mp4
- Scoped ESLint passed for changed route files.
- npm test passed: 10 files / 31 tests.
- npm run build passed.

Current limitation:

The worker is still a no-op lifecycle simulator for all actions except feature-flagged Qwen3 base voice sample generation and the feature-flagged Cosy/CosyVoice adapter contract. Cosy/CosyVoice still needs a real local bridge path before manual real generation can be proven. It does not run Demucs, Applio, FFmpeg, LTX, or any real Production Audio Studio processor.

Next implementation tasks:

1. Manually verify feature-flagged real Qwen3 sample generation against the local Qwen3 environment.
2. Prove the real Cosy/CosyVoice bridge locally once actual paths are available.
3. Add audio FX adapter.
4. Bridge local Demucs / Applio / FFmpeg pipeline into worker adapter.
5. Add LTX preview-video generation and auto-dub adapter.
6. Replace local JSON job store with production queue later.


---

## Completed mock-result UI display - 2026-05-25

Status: COMPLETE for mock result visibility.

Implemented:
- Character Voice completed jobs now display returned mock result fields, including sampleUrl/fxSampleUrl/previewAudioUrl/model paths when present.
- Audio Studio completed jobs now display returned mock result fields, including updatedClipUrl/dubbedClipUrl/finalClipUrl when present.
- Both panels label these results clearly as mock results because backend adapters are not connected yet.

Next task:
Attach completed mock results to saved character/clip records, not just local job UI state.

## Character Card / Voice Lab split-flow

Character creation is split into two valid completion paths:

1. Character Card only:
   - image/details/card are completed;
   - saved character is valid with oiceStatus: "none";
   - custom voice can be added later.

2. Character Card plus Voice Lab:
   - card state is persisted;
   - user continues to Voice Lab;
   - voice artifacts attach back to the same character record.

Characters with an existing custom voice should disable Add Voice. Characters without a custom voice should expose Add Voice and resume Voice Lab against the existing character.
## Native Character Card completion

The Character Builder supports two valid outcomes:

1. Complete Character Card:
   - saves image, character card, and details;
   - does not require Voice Lab;
   - saved character remains eligible for Add Voice later.

2. Continue to Voice Lab:
   - keeps the same character identity/card/details;
   - generates or attaches a custom voice;
   - saved characters with a voice disable Add Voice.
## Save Character Card Only / Add Voice later

The Character Builder supports saving a completed character card without creating a custom voice. The saved character remains usable as a visual character and exposes Add Voice later. Once a voice profile exists, Add Voice is disabled and shown as Voice Added.
## Production saved-character picker

Production's From Characters picker must use the same saved-character namespace as the Characters tab. It should load saved character records through `/api/characters` with the Characters tab device context and accept `previewImagePath`, `fullBodyImagePath`, `imagePath`, or character-card image fields so card-only characters are selectable.
## Production character cards as scene references

When choosing a saved character in Production, the picker may display the character thumbnail, but the actual reference image applied to Character 1/2/3 must be the saved multi-angle character card. Scene prompts should treat the card as one identity reference containing multiple angles and close-ups of the same character.
## Production picker display versus reference behavior

Production's From Characters picker displays the saved character thumbnail/name, but scene reference slots must receive the saved multi-angle character card. Characters without a saved character card may appear for visibility but are blocked from selection until a card is saved.
## Production picker definitive behavior

Production must load the same saved-character namespace used by the Characters tab. The picker displays the saved character thumbnail/name, but applying a character to a scene slot uses only the saved multi-angle character card/reference sheet.
## Mock voice output is not accepted

Character Voice Lab must not treat no-op worker output as a completed custom voice. `create_voice_sample` is valid only when the result has `mock:false` from the real Qwen3 or CosyVoice adapter. The TEST startup scripts enable the real adapter flags and run a worker loop outside the browser.
## CharactersPanel rejects mock base voices v2

The Voice Lab UI must not persist no-op worker output as a usable character voice. `create_voice_sample` only unlocks Voice Effects when the completed job result has `mock:false` and a real `sampleUrl`.
## Create Voice waits for real worker

The Character Voice Lab must not auto-complete `create_voice_sample` with the dev no-op worker. Create Voice should only complete when the persistent real Qwen3/Cosy worker writes a job result with `mock:false`.
## Voice prompt snapshot behavior v2

Voice Design prompt generation is transactional. The live UI controls do not become the model prompt until the user clicks Generate Voice Options. That action creates a provider-specific prompt snapshot for Qwen3-TTS or CosyVoice. Create Voice must use only the selected generated snapshot and must not fall back to stale prompt records.
## IndexTTS2 same-speaker voice-pack generation

Qwen3-TTS or CosyVoice is used only to create the single approved base character voice. The approved base voice becomes `reference.wav`. If the user applies Voice FX on page 2 and clicks Use Tuned, the tuned `fx.wav` becomes the approved reference and must be the reference supplied to IndexTTS2. The 200-clip training dataset is generated by IndexTTS2 using that same approved reference voice for every clip. Phrase and emotion may vary; speaker identity must not vary. Applio trains only after the IndexTTS2 pack is confirmed to be same-speaker.
## Final voice model order with IndexTTS2

1. Qwen3-TTS or CosyVoice creates one base character voice.
2. User approves Raw/Tuned/Uploaded voice in Voice FX.
3. Prepare Voice Pack uses IndexTTS2 to clone that approved reference voice into every training WAV clip.
4. Prepare Voice Training Data validates/formats the pack for Applio.
5. Train Voice Model trains Applio on the IndexTTS2 same-speaker WAVs.

The 200 training clips must be the same speaker identity with varied phrases/emotions, not 200 newly designed voices. The worker path now routes both Qwen3 and Cosy approved sources through IndexTTS2 batch clone mode and records `sourceProvider` separately from `provider=indextts2` in the dataset manifest/result.
## Minimal Training page flow v2

The Training page should show a simple two-step flow: Prepare Voice Training Dataset, then Train Voice Model. The dataset button creates the 200 same-speaker clips and may take 30-90 minutes. The Train Voice Model button remains disabled until the dataset status is Ready. Training quality remains limited to Fast, Normal, and Quality.
