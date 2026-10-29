# Unified Audio Editing implementation ledger

Scope: owner-authorized TEST-only implementation, including AuK Base/Flash and existing Character/Voice Library integration. No GitHub push or production promotion is authorized.

Baseline source: 82b83035d67c244663b97666bd7f42226d65b18a (Build 2.08).
Development branch: test/unified-audio-20261029.
Development worktree: /home/shawn-rochford/AI/work/OTG-Audio-Editing-20261029.
Isolated runtime/evidence: /home/shawn-rochford/AI/runtime/test/unified-audio.
Rollback TEST release: test3001-singularity-versions-build208-20261029T111929Z.

Confirmed boundary: TEST 3001 on shawn; production currently listens on localhost 3000 on slr, not the user-mentioned 3011. All non-3001 applications are protected. PROD PID 106784, release prod-build-2.08-82b83035d67c; production ComfyUI PID 34605. Local ComfyUI PIDs 258508 / 261592. Privileged service restart is not currently available; do not bypass permissions.

## In progress

- [x] Read approved research proposal and refresh live source, ports, pointers, queues, GPUs and storage.
- [x] Create independent local development worktree preserving the clean baseline checkout.
- [x] Locate existing isolated AuK-Flash / Qwen2.5-Omni assets and existing voice infrastructure.
- [x] Diagnose ACE service inventory mismatch: installed acestep-v15-turbo vs configured XL profiles, uninitialized service.
- [x] Owner-scoped session store, timeline contracts, durable/cancelable jobs and range-safe media.
- [x] Three-stem isolation, non-destructive mixing/export, stereo and timing validation in isolated QA.
- [x] Compact Remove/Add/Create/Enhance UI and backward-compatible tool integration in isolated QA.
- [x] AuK variants, voice/reference/character integration and actual inference qualification; documented quality/licensing limits.
- [x] Music/SFX/enhancement integration and licensing inventory; NC paths private TEST only.
- [x] Both-GPU functional and resource qualification; observed measurements recorded, not universal quality claims.
- [ ] Browser/API/regression/Android-viewport checks, TEST activation and comprehensive acceptance report.

Do not mark an unchecked capability complete without recorded execution evidence. Model downloads, node registration and passing unit tests alone are insufficient.

## Development evidence so far (not completion)

- Added contracts, owner-hashed session storage, immutable assets, realpath checks, optimistic revision checks, background native workers, polling/cancel, and range-serving API.
- Added compact four-section UI, saved sessions, timeline controls, original/edited preview, extracted/generated audio assets, voice-reference save and character assignment paths. Music/SFX/neural enhancement are still under qualification; not complete.
- Corrected legacy zero-gain fallback and short-audio truncation, preserved extraction channel count, and scoped legacy enhancement access/output paths.
- Initial 22 Vitest behavior/security tests passed. Full implementation regression/build not yet completed.
- Native mixer: all 8 combinations passed 5-second / 120-frame / 24-FPS / stereo checks; copied video bitstream hashes matched; mute-all samples were exactly zero.
- TIGER-DnR first 3090 run: 5-second stereo fixture, 12.55s wall time, 1000.42 MiB Torch peak allocation, -52.84dB reconstruction error. These are technical checks on procedural fixtures, not separation quality acceptance.
- Authenticated HTTP API tests passed 12 checks including real multipart upload, real 3090 separation, cache reuse, all eight AI-stem export combinations, ranged downloads, anonymous/cross-owner protection and stale-update rejection. Evidence: runtime/test/unified-audio/evidence/api-1793284404075/results.json.
- AuK-Flash first new male voice completed in 26.47s on 3090, but local CPU Whisper detected an extra phrase. Do not treat this as a speech-quality pass. Resident Base/Flash evaluation is still pending.
- A new H3 workload arrived during resident qualification; the test exited between cases. Continuous queue/yield monitoring was added to native workers and qualification; no existing jobs were canceled or services restarted.
- Isolated 5060 Ti Python 3.12 / Torch 2.7.1+cu128 runtime installed under /home/slrochford123/AI/runtime/test/unified-audio. No packages installed into production environments. Model inference there is not yet verified.
- Isolated dev app runs at http://100.75.162.64:3308/app, separate from unchanged live TEST 3001. Fixed Node-only instrumentation compilation and disabled duplicate schedulers in this development process.
- Browser verified authenticated new UI and gallery import. Browser-extension file upload requires Allow access to file URLs, which was not changed; API upload is tested instead. Original procedural QA video was added to the observed TEST browser owner's gallery without overwriting media.
- Live TEST activation remains pending. PROD is untouched. GitHub push remains held.

## Continued qualification (2026-10-29, still not completion)

- Added synchronous, exclusive per-session job admission reservation before awaits. Stale reservation recovery still needs hardening/testing.
- Implemented cancelable SSH/rsync transport to the isolated 5060 Ti runtime; native TIGER and authenticated app/API separation/export passed there. Evidence: `remote-transport-75a9d6d0074e4bffa2efe2736cc00fe0/qualification.json`, `api-1793285949016/results.json` (12 checks).
- Native 5060 TIGER cold: 46.12s worker; transport qualification subsequent fresh process: 31.72s worker / 36.76s delivered, 999.74 MiB Torch peak. These are fresh-process runs, not resident-model warm timings.
- Native TIGER CPU 5s stereo succeeded but took 290.78s: not enabled as a normal UI choice. MossFormer CPU succeeded in 3.89s; 3090 in 11.46s, 263.28 MiB Torch peak (cold process).
- Installed official BandIt v2 English weights after confirming Zenodo API license CC-BY-SA-4.0. Source d5563d9031e95fdaa3e5a73d5020b9a0df61adb6; official checkpoint MD5 matched 9b74787e7f752709ce986ba1b1ac29a9. Strict weights-only load, no unsafe globals. Independent-channel 5s CPU inference 7.68s; synthetic diagnostic favored BandIt, but realistic comparison and any integration remain pending. Do not call it a perceptual winner.
- Added genuine Woosh manual DFlow and automatic DVFlow, 4-step publisher settings, job-private config wrappers, shared weights read-only, 48k stereo, sample-exact overlapping-window assembly. Private TEST / non-commercial labeling is explicit. Manual 4s: 9.93s worker; automatic lion 8s: 12.92s; automatic 16s across three windows: 33.38s. Final assembly asserted exact sample count. Model audit found four unused `dit.preprocessing.to_logvar_ctm` tensors; inspect missing-key audit before final qualification. Sync mask warning recorded.
- Original stock lion clip acquired from Wikimedia: MathieuMD, CC-BY-SA-4.0. Exact publisher metadata saved under `evidence/stock/lion-provenance.json`. Silent 8s and 16s derivatives are evaluation-only, not placeholder outputs.
- Repaired ACE using a private native handler with installed non-XL Turbo, leaving existing API service uninitialized/unchanged. Real instrumental 12s stereo generation: 18.99s worker, 1.83s init / 8.81s generation, 4629.47 MiB Torch peak. Whisper emitted an implausible generic YouTube outro on this instrumental: do NOT equate that hallucination with confirmed vocals or a quality pass. Need VAD/signal/listening-oriented checks and actual app music tests.
- AuK Base and Flash both generated male/female and cloned new sentences on both GPUs. Missing `audioread` in the NEW isolated environments caused initial cloning failures; installed only in those environments and retested. All six clone outputs on each GPU matched requested words in local CPU Whisper. Four 5060 design outputs also matched exactly.
- AuK evidence: `auk-3090-resident-r3`, `auk-3090-clone-r4`, `auk-5060ti-resident-r1`, `auk-5060ti-clone-r2`. First r1/r3 clone attempts failed; retain those failures, do not erase them from reports. Latest r2/r4 pass. Flash locks its own 4-step recipe; Base 32. 5060 prepared reference 2.5s, 3090 5s, CPU offload. Clone Torch peak ~10.1 GiB. SpeechBrain ECAPA diagnostic `evidence/speaker-consistency.json` shows all same-reference similarities exceed cross-voice comparisons; not a subjective identity guarantee.
- Configured speech segment budgets (5060 5s/12 words, 3090 8s/20 words); long-dialogue execution and emotion/whisper tests remain pending. Existing speech generator uses own isolated Python/source now, shared AuK weights read-only. Native CLI still reloads per segment; optimize only if needed without leaving GPU-resident services.
- Full authenticated app creation test caught a real Character Library requirement: new characters require a nonempty imagePath. Added owner-scoped neutral waveform PNG via existing Sharp, preserving original validation and marking voice-first placeholder metadata. Retest passed on 3090: `create-api-rtx3090-1793287567116/results.json` (3 checks): generated voice -> saved Voice/Character Library -> reloaded character -> new sentence -> 30s export / 720 frames / 24FPS / unchanged video hash. 5060 equivalent still running when this note was written.
- Added browser draft persistence and Undo persistence. No global application layout changes. Actual browser silent export: playable 5.0s 640x360, readyState4. Mobile viewport override390x844 yielded document375px / workspace351px / no horizontal overflow; main buttons44px tall. Viewport override currently ACTIVE; reset before final handoff.
- Remote main disk was down to21GB free after isolated AuK assets. Additional isolated ACE/Woosh models/venvs are on owner-writable `/mnt/otg_bulk/slr-audio-test-20261029` (1.4TB free), not production model libraries. Own Torch2.10+cu128 ACE and Torch2.8+cu128 Woosh envs installed; deps/model transfer finished. Native 5060 music/SFX/Moss validation still pending. Remote Comfy production env is Torch2.13/Transformers5 and was NOT changed or used for these adapters.
- 5060 idle model cache release was performed through normal ComfyUI `/free` after verified empty queue; no service stop/reset/restart. Freed VRAM and RAM for isolated AuK. PROD PID106784 and Comfy PID34605 remained unchanged. Do not call maintenance free_vram: it stops the production service.
- Latest focused suite: 30 tests passed (including private-owner context), TypeScript repeatedly passed. ESLint has three unused `_file` warnings remaining. Full build, durable/cancel/race tests, audio creation API tests for music/SFX/enhance, long/mono/silent/loop/ducking fixtures, representative separation comparison, legacy dialogue conversion regression and live TEST3001 activation remain unfinished.

### Latest continuation checkpoint

- Both full voice/character HTTP integration retests passed: `create-api-rtx3090-1793287567116` and `create-api-rtx5060ti-1793287568276`, 3 checks each, including untouched 30s visual bitstream. The earlier failed character tests remain as honest failure evidence.
- 5060 native qualification ALL completed under `evidence/native-cases-rtx5060ti-1793287804`: MossFormer13.64s, music163.07s cold bulk-disk process, manual Woosh134.88s first load, automatic8s85.55s first load, automatic16s43.67s subsequent disk-cached fresh process. These are NOT resident-model warm timings. Results were rsynced to local evidence with identical folder name; embedded file paths inside copied result.json still name the remote original.
- BandIt worker integrated (not just standalone comparison). 3090 actual worker5.32s /715.46MiB peak; CPU actual worker15.23s; 5060 actual worker24.69s under `native-cases-rtx5060ti-1793288341/bandit`. All5s stereo. Added Advanced separation method selector. `separate-bandit` capability enabled CPU/3090, 5060 still needs capability flag and transport/API test. Default remains TIGER pending representative mixture comparison. Source+weights copied to remote private runtime. Cache now respects selected engine; explicit model change reruns, slider changes don't.
- Added job elapsed-time derivation during polling (previous stage file could show0 elapsed during long model call), and crash-safe reservation ownership using Linux process-start token. Two new lock tests; focused suite now32 passed.
- GPU watcher now additionally detects new external CUDA compute processes or >256MiB allocation growth and terminates only its own worker/child. Existing direct Comfy queue and voice file locks remain. This protects native audio/voice work not visible in Comfy queues, but is not a claim of perfect atomic cross-PROD admission. Latest script needs resync to remote after all edits before further qualification.
- Fixed source multichannel silent downmix: >2-channel mixes explicitly refuse, originals preserved. Stereo added to mono source now retains stereo. Added VP8/VP9 export as WebM+Opus while copying video, avoiding invalid VP8-in-MP4. New format path still needs actual regression execution.
- Added generated/stem `suggestedLane` metadata so music defaults to Music and restored speech to Speech, rather than every non-AuK asset defaulting to Effects.
- Voice-library listing now enforces owner voice-ID namespaces and per-voice realpath containment, not merely the shared voices root.
- Private ACE adapter now checks only its three required native instrumental component families; it does not use the optional planning/lyrics LM. This prevents upstream from trying to download an unused LM on 5060. Strict selected-weight readiness remains. Retest revised adapter still pending. HF offline was set during previous run; no paid service invoked.
- Instrumental ACE file produced an implausible Whisper outro. Follow-up local Silero VAD returned NO speech intervals. This supports a Whisper music hallucination, not a proven sung-vocal output. Persist full diagnostic before final report; no human listening quality score is established.
- Added server-side source handoff from Unified Audio Editing to existing Dialogue Replacement (copy into owner-scoped edit_video_jobs; no Android blob/re-upload). `EditVideoPanel` holds initial source metadata; `EditVideoVoiceDubbingPanel` can analyze an existing authorized sourcePath without upload, with original upload flow preserved. TypeScript/ESLint run session37477 was pending when checkpoint written. New handoff needs browser/API validation; do NOT run old analysis without first inspecting possible paid calls/resource handling.
- New voice-only character avatar uses existing Sharp dependency and genuine neutral waveform PNG under owner character directory; no empty imagePath or validation weakening.
- Actual TEST3001 and PROD unchanged at latest check: TESTPID1006213 / Build2.08, PRODPID106784 / Build2.08, remote ComfyPID34605. Live activation remains root-only per existing guarded script; do not bypass its explicit root requirement by killing the managed process.

Priority next: Finish representative audio fixtures and separation comparison; actual API music/SFX/enhance workflows; extended mixer tests (short/long, mono/stereo, VP8/WebM, zero gain, loop/fades/duck, silent inputs); cancellation/recovery/ownership regressions; longer/emotive AuK and voice extract/reuse; safe legacy voice regression; full browser + mobile validation; source/model inventory/license report; full build/staged TEST activation with rollback. Do not hand off partial completion or push GitHub/PROD.

## Current checkpoint — packaged Build 2.09, managed activation pending

The preceding chronological entries are historical. Current detailed findings are in `docs/unified-audio-validation.md`.

- Both GPU voice/character API flows passed; music, manual and actual video-conditioned longer SFX, neural restoration, track-specific cleanup, timeline/gallery/library/handoff tests passed 9 checks on each GPU.
- All eight real stem combinations passed both GPUs through the exact standalone artifact: `api-1793291540724`, `api-1793291541882`, 12 checks each. Further 5060 transport-heartbeat regression `api-1793292298832` passed 12 checks.
- Fixed a real FFmpeg `aloop` invalid-timestamp / lost-leading-delay bug by using a job-local finite loop derivative and demuxer looping. Eight extended mixer tests now pass, including 120 seconds, VP8/WebM, mono/stereo, zero gain, fades, looping and measured speech ducking.
- Real controlled 12s mixture comparison favored BandIt for music isolation and speed, with essentially tied speech SI-SDR. New sessions default to BandIt; TIGER remains a deliberate alternative. Not a universal perceptual-quality claim.
- AuK long speech, soft/whisper and happy-directed tests completed both GPUs. ASR preserved short/soft text including enhanced output; 5060 long output inserted one word. Emotion/naturalness remains provisional. First 3090 happy test was safely refused while busy; a bounded later retry passed.
- Actual existing Seed-VC conversion and full legacy Dialogue Replacement passed. The latter retained 30s / 720 frames / copied visual stream. Analysis still honestly labels estimated speaker lanes when genuine diarization is unavailable. Added TEST-only GPU admission to that legacy analysis handoff and removed its short-audio mux truncation.
- Fixed enhancement provenance so enhancing unrelated generated speech cannot replace a source speech stem. Added owner-library metadata and escaping-reference regressions.
- Exclusive/resumable job admission, CPU/remote cancellation, canceled-state recovery, supervisor/HUP guard and remote transport heartbeat are implemented. Actual lease expiry/recovery CPU tests passed. No production process was killed/reset/restarted.
- Final focused regression: 91 tests / 13 files passed; TypeScript passed. Standalone Next15.5.27 build passed. Existing baseline lint/build warnings are disclosed, not described as clean.
- Browser original voice -> save/assign new character -> new line -> timeline -> export -> enhancement A/B -> Dialogue Replacement/analysis passed. Packaged reload retained session/timeline/voice inputs. Mobile390x844 override had no horizontal overflow and44px section controls; viewport reset. Physical Android instrumentation is not claimed.
- Final dependency audit found the required Qwen2.5-Omni-3B is research/non-commercial despite AuK's own MIT code/weights. Private TEST remains authorized; runtime notices and new speech metadata disclose the restriction. No commercial AuK clearance is claimed.
- Model/runtime inventory includes exact source revisions, package versions and SHA256 hashes; remote environment inventory collected without touching production envs. Evidence aggregator reads existing results only.
- Packaged candidate: `/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-unified-audio-build209-20261029T163017Z`; its own complete dependencies, environment/data links, Python adapters and release-local TEST bootstrap are included.
- Exact artifact QA listener3308 is running with duplicate schedulers disabled. The prior own development server was stopped gracefully. Live TEST3001 remains Build2.08 / PID1006213 as last checked. PROD remains Build2.08 / PID106784; remote ComfyPID34605. No GitHub push.
- Guarded activation command prepared and read-only preflight passed: `/home/shawn-rochford/AI/research/unified-audio-build209-20261029-MSkspkFf/activate-test.py`. Existing OS policy requires owner sudo for TEST restart. Noninteractive sudo is limited to unrelated GPU controls; do not bypass it. One asynchronous request for that activation has been sent; it is NOT owner acceptance/manual feature testing.

Next: obtain the OS-authorized guarded activation, then independently verify actual port3001 PID/CWD/build/capabilities/authenticated processing/cancel and protected PROD boundary. Only then produce the final owner-acceptance release. Maintain GitHub/PROD hold.
