# SLR Studios Unified Audio Editing — Build 2.09 validation

Date: October 29, 2026. Scope: TEST only, including AuK.

## Delivery state — not yet an owner-acceptance release

The implementation is built and running as the exact packaged release on the separate QA listener `http://100.75.162.64:3308/app`. The managed TEST listener on port **3001 still runs Build 2.08** at the last verification. Its guarded switch requires the owner's OS sudo authentication. No GitHub push or PROD promotion is authorized or performed.

The remaining release gate is the guarded 3001 activation followed by Codex's final checks against that listener. Do not interpret the packaging result, this report, or the temporary QA URL as proof that 3001 has been upgraded. Do not request owner acceptance until that gate is complete.

Packaged candidate:

`/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-unified-audio-build209-20261029T163017Z`

Build/activation evidence:

`/home/shawn-rochford/AI/research/unified-audio-build209-20261029-MSkspkFf`

The owner-only activation command, on **shawn**, is:

```bash
sudo /usr/bin/python3 /home/shawn-rochford/AI/research/unified-audio-build209-20261029-MSkspkFf/activate-test.py
```

It verifies the expected current release, artifact hashes, qualified engine configuration, Node/native dependencies, environment/data links, existing durable-job guards and direct queues. It refuses active work. It restarts only `otg-test.service`, preserves environment policies and existing databases/media, and uses the existing automatic application rollback. It does not restart ComfyUI or touch PROD. No credential is needed in chat. A successful activation is followed by Codex's internal live-3001 validation, not a request for manual feature tests.

## Implemented workspace

Open Edit Video → Audio Editing. Extract Audio and Remove Music are consumed by the unified workspace; unrelated editing tools remain available. One source video, owner-scoped saved session, persistent preview and timeline are shared by:

| Section | Implemented behavior |
|---|---|
| Remove | Real speech/effects/music separation; all eight keep/remove combinations; individual gain, mute, solo, audition and reset; deliberate engine choice; cached stems reused for edits |
| Add | Upload, existing audio library, extracted and generated assets; overlapping clips; visual three-lane overview; compact expandable clip editor; placement, trim, duration, gain including zero, fades, looping, mute, replacement and optional speech ducking |
| Create speech | AuK-Flash default and AuK Base; new voice description, authorized saved reference or Character Library voice; delivery instruction; automatic short-segment assembly; audition; save reference; assign existing/new voice-first character; add to timeline |
| Create music | Repaired isolated ACE-Step 1.5 non-XL Turbo instrumental workflow; prompt, duration and seed; no paid API or optional planning/lyrics LM |
| Create effects | Actual Woosh text-conditioned manual generation and video-conditioned automatic generation; selected range, optional description, 8-second model windows with overlapping assembly for longer clips |
| Enhance | Conservative, explicitly non-neural track-specific cleanup; optional MossFormer2 speech restoration; dry/wet strength; untouched original retained; actual original/enhanced audio switching; unrelated generated audio never silently replaces a source stem |
| Export/library | Original soundtrack, separated stems, extracted ranges, generated assets and edited mix; original video stream copied into delivery; downloads/range requests, existing owner gallery/audio library, reference voice library and character associations |

Mixing never reruns separation. Changing the separation method is explicit. Full keep-all and mute-all do not require an AI model. Audio that exceeds the video endpoint is visibly warned and trimmed at export; audio is padded if shorter. Video is not regenerated, frozen, stretched or shortened. Undo preserves edit settings; source media is immutable.

Native GPU operations run in isolated processes, not production custom nodes. The 5060 Ti receives only owner-session inputs over the private SSH/rsync transport. Model caches and temporary files belong to this TEST runtime.

## Both-GPU qualification

Actual inference succeeded on both GPUs, not just model loading or node registration. Figures below are observed functional-test timings, not a universal performance promise or controlled hardware contest. The 5060 host's bulk-disk/model initialization cost is significant.

| Capability | RTX 3090 24 GB | RTX 5060 Ti 16 GB | Observed Torch peak allocation |
|---|---|---|---|
| BandIt v2, 5s stereo | Pass; 5.32s first worker, ~5.07s later worker | Pass; 24.69s first worker, ~26.25s later worker | ~715 MiB; 12s example ~1042 MiB |
| TIGER-DnR, 5s stereo | Pass; 12.55s initial worker | Pass; 46.12s initial, 31.72s later fresh process | ~1000 MiB |
| MossFormer2, short speech | Pass; 11.46s initial worker | Pass; 13.64s initial worker | ~263 MiB in measured short case |
| AuK-Flash, 5s reference cloning | Pass; 8.50s init + 8.18s first evaluation; 6.69s resident/offloaded next evaluation | Pass; 29.81s init + 32.21s first evaluation; 11.79s resident/offloaded next evaluation | ~9.9 GiB in reference tests |
| AuK Base, 5s reference cloning | Pass; 6.39s init + 7.80s first evaluation; 7.72s resident/offloaded next evaluation | Pass; 27.23s init + 30.62s first evaluation; 13.24s resident/offloaded next evaluation | ~9.9 GiB in reference tests |
| ACE instrumental, 12s stereo | Pass; 18.99s initial worker, 17.60s later application worker | Pass; 163.07s initial bulk-disk worker, 37.30s later application worker | ~4629 MiB |
| Woosh manual, 4s stereo | Pass; 9.93s initial worker | Pass; 134.88s first bulk-disk worker, 35.59s later application worker | ~3576 MiB |
| Woosh automatic, 8s | Pass; 12.92s initial worker | Pass; 85.55s first bulk-disk worker | ~6737 MiB |
| Woosh automatic, 16s/windowed | Pass; 33.38s initial, 16.56s later application worker | Pass; 43.67s native and 38.97s later application worker | ~6739 MiB |
| Mixing, extraction, conservative cleanup | CPU path passed; GPU not required | CPU path passed; GPU not required | No CUDA allocation required |

Only explicitly labeled resident/offloaded AuK evaluations are resident-model warm results. Normal app jobs deliberately release their models/processes after completion to protect shared work. Later fresh-process runs may benefit from disk/kernel caches, but are **not** resident-model acceleration. AuK cold and warm examples use different sentences for identity testing; they are operational timings, not an identical-input algorithm benchmark. Not every engine has a resident-warm measurement because the deployed process model does not retain it.

Torch peak allocation is not total physical VRAM. The JSON inventory also records the largest process RSS peak, not a summed whole-host peak. AuK's observed worker/child RSS was roughly 15.5–17 GiB; it requires 18 GiB available host RAM before loading. CPU offload and short-reference budgets are used: 5 seconds / 12 words per segment on 5060 Ti, 8 seconds / 20 words on 3090; 2.5-second versus 5-second prepared references. Whitespace-free writing now also has bounded short segments; non-English output quality has not been qualified.

## Models, revisions and licensing

All exact configured weight paths, SHA256 hashes, source revisions and installed environment package versions are saved in `evidence/model-runtime-inventory.json`; remote environment versions in `evidence/environment-inventory-5060ti.json`.

| Model / runtime | Selected revision | Decision and limits |
|---|---|---|
| BandIt v2 English | Code `d5563d9031e95fdaa3e5a73d5020b9a0df61adb6`; official Zenodo English checkpoint | Default separator. Apache-2.0 code; official checkpoint CC-BY-SA-4.0. Official MD5 matched `9b74787e7f752709ce986ba1b1ac29a9`. Redistribution/adaptation obligations must be respected. |
| TIGER-DnR | Code `9f18d4a10a7137e1ce8052cfb62215179f1287b6`; weights `b7a59560bbca10febbcd46fb01600f868e587f57` | Apache-2.0 alternative. Strict weights-only loading. |
| AuK Base / Flash | Code `871bf3d4635c5ca0ecb6b85f3c4e29c4682a88c7`; Base weights `790742b71a4430120daf2b2099192abae449eb9f` | Both operational. AuK's own code/weights are MIT; Base uses 32 steps, Flash its dedicated 4-step recipe. **Required Qwen2.5-Omni-3B is under Qwen Research License, non-commercial evaluation only. This complete configuration is not commercially cleared.** |
| MossFormer2 SE 48K | Code `6b3774dc79c46ae8bed2a4fa5f706f0ac8c75c61`; weights `eff8c97925c8bec812af707814b3e5d777fd4503` | Apache-2.0 speech restoration, both GPUs and CPU verified; no music/FX substitution. |
| ACE-Step 1.5 Turbo | Code `dce621408bee8c31b4fcf4811682eb9359e1bc94` | Operational non-XL DiT/VAE/Qwen3 embedding path; MIT model/code, component notices retained. Existing uninitialized XL API service was not altered. |
| Sony Woosh | Owned reviewed wrapper `283b9b1a8efba182e8c08433cdde7f6bb58a9ff7`; official DFlow/DVFlow components | Real manual/automatic inference; **weights CC-BY-NC-4.0, private TEST only**. One local source patch records checkpoint key audits; no production node was changed. |
| YuE2 | Preferred candidate retained on bench | Non-commercial weights, less practical memory/runtime fit; existing assets located but not falsely claimed to be operational. ACE is the explicit working alternative, not a claim of equal quality. |
| NemotronLabs RE-USE / laughter variant | Research option, not installed as an active engine | New OpenMDW release differs from older non-commercial RE-USE. Overlap/primary-speaker suppression risk and extra dependency qualification make it unsuitable as an automatic whole-conversation default. MossFormer2 plus conservative bypass is the verified practical choice here. No RE-USE inference claim is made. |

Primary references: [BandIt official weights](https://zenodo.org/records/12701995), [TIGER](https://huggingface.co/JusperLee/TIGER-DnR), [AuK](https://huggingface.co/tencent/AuK), [AuK-Flash](https://huggingface.co/tencent/AuK-Flash), [required Qwen encoder license](https://huggingface.co/Qwen/Qwen2.5-Omni-3B/blob/main/LICENSE), [MossFormer2](https://huggingface.co/alibabasglab/MossFormer2_SE_48K), [ACE-Step](https://github.com/ace-step/ACE-Step-1.5), [Woosh](https://github.com/SonyResearch/Woosh), [RE-USE candidate](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-RE-USE).

The AuK model cards explicitly require the separate Qwen encoder. AuK's MIT label does not replace that encoder's license. TEST notices and new speech asset metadata now disclose the dependency restriction. Asset license labels describe model/pipeline provenance; they do not adjudicate copyright in user content or imply that every weight license automatically transfers to generated outputs. Commercial deployment needs a separate licensing review/permission or a verified permitted alternative; do not silently swap in a differently shaped encoder.

Native environments: core audio Torch 2.7.1+cu128 / Transformers 4.57.6; Woosh Torch 2.8.0+cu128; ACE Torch 2.10.0+cu128. Remote ACE/Woosh environments and large models are under `/mnt/otg_bulk/slr-audio-test-20261029` to avoid exhausting its root disk. Existing production environments, CUDA and drivers were not upgraded or modified.

## Functional and quality evidence

Evidence base:

`/home/shawn-rochford/AI/runtime/test/unified-audio/evidence`

- `vitest-final.json`: **91 tests / 13 files passed**, including contracts, lock recovery, paths, library ownership, character behavior, existing voice/training lifecycle and legacy media access.
- TypeScript no-emit check passed. New core UI/API modules have no remaining unused-file warnings. Existing legacy files still have baseline lint warnings; they are not presented as newly lint-clean. The standalone Next 15.5.27 build completed; it retains the pre-existing package-version named-import warning.
- `api-1793291540724/results.json` and `api-1793291541882/results.json`: exact packaged release, **12 checks each**, both GPUs with BandIt, all eight real stem exports, stereo, 24 FPS, 120 frames / 5 seconds, range downloads, cache reuse, anonymous/cross-owner denial and stale-revision protection. Earlier TIGER runs also passed 12 checks on each GPU.
- `api-1793292298832/results.json`: repeat remote end-to-end BandIt/export verification after adding the remote transport heartbeat safeguard.
- `create-api-rtx3090-1793287567116` and `create-api-rtx5060ti-1793287568276`: real AuK → existing Voice Library → Character Library → reload character → new dialogue → 30-second video export, 720 frames / 24 FPS / unchanged video bitstream.
- `generation-api-rtx3090-1793288694548` and `generation-api-rtx5060ti-1793290995169`: **9 checks each**, real instrumental music, manual effects, video-conditioned 16-second effects, neural speech restoration, music/FX cleanup, overlapping assets/fades/loop/ducking, gallery/library and source handoff.
- `native/extended-mixer-1793289236/results.json`: **8 extended cases passed**, explicit zero gain, mono/stereo behavior, silent video, VP8/WebM video copy, 120 seconds / 2880 frames, short looped sound with preserved delay/fades and measured ducking.
- `cancel-api-1793288819984`, `cancel-api-rtx5060ti-1793289977245`: actual cancellation, concurrent admission refusal, terminal-state recovery and subsequent export. Only owned processes were signaled.
- `lifetime-guard-1793292186/results.json`: actual CPU worker stopped at expired transport lease, then succeeded when heartbeats were renewed. Remote workers also stop on supervisor loss/HUP; SSH keepalives and a 45-second transport lease avoid indefinite unattended work after connection loss.
- `seedvc-api-1793289540616/results.json`: real existing Seed-VC reference conversion from original synthetic QA speech. Local ASR retained the intended words.
- `dialogue-api-1793291171154/results.json`: actual existing analysis/Seed-VC Dialogue Replacement route; **30-second / 720-frame original video stream retained**. Analysis used Demucs and honestly labeled estimated speaker lanes, not verified speaker diarization.

### Separation comparison and honest limits

The representative 12-second mixture used two original AuK voices with overlap, generated instrumental music and actual generated door/bell effects, with saved ground-truth stems. On this controlled mixture, BandIt and TIGER speech SI-SDR were effectively tied (13.88 vs 13.89 dB); BandIt music was 6.54 vs 0.29 dB, FX 7.31 vs 6.84 dB, and worker time 5.25 vs 15.90 seconds. This supports BandIt as the default for this setup, **not** a universal perceptual winner.

See `realistic-mixture/separation-synthetic-diagnostic.json` and `PROVENANCE.json`. Both models process stereo channels independently; this is not jointly trained stereo restoration. BandIt reconstruction error on the example was about -27.27 dB; do not claim lossless mixture recovery. Some leakage, quiet-detail changes and phase differences remain possible, especially overlapping voices and reverb. No extra residual is silently added twice.

### AuK content / identity checks

- Both variants created new male/female voices and generated new sentences from saved original synthetic references on both GPUs.
- Local CPU Whisper matched all six bounded clone test sentences on each GPU and the four 5060 voice-design outputs; punctuation differences were disregarded.
- ECAPA diagnostic `speaker-consistency.json`: same-reference similarities exceeded opposite-voice comparisons in all 12 measured cases. Short synthetic speech is out of the model's original benchmark domain; these are provisional supporting similarities, not human listening scores or identical future voices.
- Longer dialogue assembled to 14.00 seconds (3090) and 14.02 seconds (5060). The 3090 transcript matched the requested words. The 5060 transcript inserted one extra word, “no,” in “two friends.” Preview/regeneration remains necessary for critical dialogue.
- Quiet/whisper-directed Base output and 35% enhanced versions retained all requested words in ASR on both GPUs. Happy/brief-laugh-directed Flash also retained the text. Intelligibility is verified; the intended emotional nuance or naturalness of laughter has not been established by a listening panel. Controls are labeled instructions, not guarantees.
- Initial cloning failed because `audioread` was absent in the **new isolated environments**. It was installed there only; successful retests and original failure logs are retained. Initial design-template extra-word behavior was corrected using the publisher's actual instruction format.
- Existing reference voices/trained models/characters were preserved. Saving a reference is explicitly distinct from Applio/RVC training. Existing training entry points and lifecycle regressions remain intact; no claim is made that a new full RVC training run was performed on both GPUs.

### Music / effects / enhancement limits

The instrumental music sample had no detected speech intervals in local Silero VAD. Whisper hallucinated a generic outro on music; that is retained as a diagnostic failure, not asserted as confirmed singing. Woosh really consumed video conditioning and produced sample-exact long-window stereo audio. This does not guarantee every roar, footstep or door onset is perceptually correct. Checkpoint audit found four unused training/log-variance tensors; missing separately loaded component prefixes and the synchronization-mask warning are retained in logs. No invented subjective quality scores are supplied.

MossFormer2 is exposed only for speech; music and FX use separate conservative filter recipes rather than a vocal model. Low default wet mix, original retention and A/B comparison protect quiet speech and secondary speakers but cannot guarantee artifact-free denoising. Severe clipping, missing frequency detail or original surround channels cannot be recovered by this implementation. Surround/spatial reconstruction is not claimed. More-than-stereo source mixing is explicitly refused rather than silently downmixed.

## Browser, Android-sized UI and safety

Authenticated browser testing created an original described voice, saved it to a new QA Character/Voice Library entry, selected that saved character and generated a different line. It added the result to the timeline, edited music placement/length/gain/fades/loop, exported a playable video, switched original/enhanced audio, transferred the source to Dialogue Replacement and completed analysis. Reloading into the standalone build retained the session, timeline, speech text and character selection. Settings displayed Build **2.09**.

At the temporary 390×844 mobile override, document client/scroll width both measured 375 px, workspace 351 px; the four main section buttons were 44 px tall. The video was playable, 5.00s / 640×360 / readyState 4. Desktop width had no horizontal overflow. The viewport override was reset. Current packaged-build browser logs had no new errors/warnings after its start; historical development errors were separated from current results.

This validates responsive browser behavior, **not** a physical Android-device instrumentation run. The installed Android wrapper was not modified or re-signed. Browser-extension OS file-upload permission was not changed; real multipart uploads were tested through the authenticated application API, while browser source import used gallery selection.

Security includes authenticated owners, hashed session namespaces, realpath containment, opaque library IDs, no raw output paths in public session/job payloads, cross-owner refusal, optimistic revisions, durable jobs, exclusive/crash-safe admission, process-identity checks before cancel, narrow child environments without app/API secrets, isolated caches and safe GPU admission. New external CUDA work causes only this audio worker to yield. These protections are not represented as a perfectly atomic scheduler across every unrelated PROD process.

PROD application PID/release and ComfyUI service PIDs stayed unchanged during recorded checks. Actual PROD listens on localhost 3000, not the user-mentioned historical 3011; all non-TEST applications were protected. One normal idle ComfyUI cache unload was used on the 5060 after empty-queue verification. No active job was stopped, no physical GPU was reset, and no service/driver was restarted for inference.

## Representative direct media paths

All below are real completed artifacts, not placeholder videos:

- Mixed conversation / original voices: `evidence/native/conversation-30s.mp4`, `evidence/auk-3090-resident-r3/flash-male.wav`, `flash-female.wav`.
- Both-GPU character-dialogue exports: `evidence/create-api-rtx3090-1793287567116/character-dialogue-30s.mp4` and `evidence/create-api-rtx5060ti-1793287568276/character-dialogue-30s.mp4`. Their `original-voice.wav` and `character-new-dialogue.wav` are also retained.
- Generated multitrack videos: `evidence/generation-api-rtx3090-1793288694548/generated-multitrack-16s.mp4` and `evidence/generation-api-rtx5060ti-1793290995169/generated-multitrack-16s.mp4`.
- Actual legacy replacement: `evidence/dialogue-api-1793291171154/dialogue-replaced-30s.mp4`.
- Windowed SFX: `evidence/generation-api-rtx5060ti-1793290995169/automatic-16s.wav`.
- Longer speech: `evidence/speech-quality-rtx3090-1793290368739/long-dialogue.wav` and `evidence/speech-quality-rtx5060ti-1793290369898/long-dialogue.wav`.
- Source lion: `evidence/stock/lion-silent-16s.mp4`; attribution/provenance in `evidence/stock/lion-provenance.json`. MathieuMD, Ishikawa Zoo, CC-BY-SA-4.0; muted/trimmed derivatives. [Publisher page](https://commons.wikimedia.org/wiki/File:Ishikawa_Zoo_-_Animals_-_36_-_2016-04-22.webm).

`evidence/qualification-summary.json` aggregates observed metrics and evidence paths without starting jobs. Failed initial experiments remain visible in their individual reports. Success lists do not erase failures or convert ASR scores into quality guarantees.

## After guarded activation

Codex must verify the actual managed PID/CWD/release, `/app`, health, authenticated build identity, audio capability endpoint, existing user/session/media continuity, actual processing/cancel on the 3001 origin and the protected PROD boundary. Only then should one owner-acceptance session be requested.

The eventual compact walkthrough: choose a video; audition Remove combinations; Add/move/trim two assets; Create speech with a saved/new character plus music and automatic effects; Enhance/A-B a speech track; export and save/download. Advanced contains device/method/seed/variant controls and contextual help. No approve/accept creation checkboxes are added. GitHub/PROD remain on explicit hold even after a successful owner review until separately authorized.
