# Experimental workspace TEST implementation

This document records the Testing-tab execution follow-up first, then preserves the original planning-tab implementation and activation history. The separate H3 Admin implementation and HTTP UUID repair are in [Private H3 generation — TEST qualification](h3-private-generation-test.md). Historical planning-only restrictions below do not describe the newly qualified Testing recipes.

## Testing execution follow-up — November 2, 2026

The Testing workspace now supports actual isolated inference for six of its seven research entries. NVIDIA Open-H3-Regenerate-2K stays disabled with an explicit implementation blocker. Neither downloaded weights nor a visible model card is considered successful qualification.

Evidence root: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-iszHqvZP`.
Qualified application build: `59rXFcAoizfRlkKTOe_Yj`, from `build-qP6mjc/source` beneath that root. **Activated and live-verified on TEST at 09:13 UTC (04:13 EST), November 2.** Activation details and rollback are recorded below.

### Available experiments and honest boundaries

| Testing entry | Qualified path on RTX 3090 | Actual recipe / important limitation |
| --- | --- | --- |
| Pika H3 Flex | Text, first-frame image, image/video reference, video regeneration | Correct FL2VA or Ref2VA base and matching Pika adapter; 6 LCM steps, published Pika sigmas, CFG 1, video/audio shifts 12/3, dense attention. No legacy Turbo stacking. Installed INT8 encoder, not the newest template's NVFP4 encoder. |
| Cinematic spatial refinement | Text → draft video → 2x spatial enhancement | Same Pika draft plus existing RealESRGAN x2. This is a local experiment, **not** Pika's hosted cinematic/4K product. Frames and generated audio are retained; no interpolation. |
| H3 character swapping | One video plus one replacement-character image | Real Ref2VA conditioning with the Pika adapter. Prompt-guided regeneration, **not** SAM3-masked or pixel-exact replacement. Observed background changes are a material limitation. |
| SoL Refiner / DenoMix | Image-reference video → 2x latent refinement | DenoMix INT8, 8 Euler draft steps, checksum-verified 3D latent lifter, 2 final Euler evaluations, DMD/refiner adapters and SoL sparse attention. Correct AV outputs preserve the draft audio. Uses a core reference-node/FP16-VAE adaptation. Not full NVIDIA Regenerate. |
| Pika versus original H3 | Reference video, selectable Pika 6-step or original Standard Turbo 8-step | Same Ref2VA base/reference interface; original baseline uses its proper acceleration LoRA, Euler/simple, CFG 1, shifts 6/3 and SLA. Receipts disclose the different sampling recipes. Each run starts a fresh worker; do not interpret cache differences as algorithmic speedup. |
| Qwen-powered Director Studio | Text concept → structured local shot plan → contextual revision | Private Qwen3.5 4B Q4_K_M, GPU layers verified, owner-scoped JSON export and saved-session revision context. No OpenAI call, media analysis, automatic video generation, or modification of Story Creator. This is a local prototype, not a copied third-party Director Studio. |
| NVIDIA Open-H3-Regenerate-2K | Disabled; plans and notes remain available | Official architecture requires 50 Sharpcurve AdaLN branches beyond a normal linear LoRA merge. No verified private ComfyUI adapter implements these branches. The DenoMix rank-16 refiner is not a substitute. The approximately 210 GB official bundle was not downloaded just to display a working-looking control. |

Only the RTX 3090 is qualified. Auto chooses that supported lane and waits for shared admission; the 5060 Ti is explicitly unavailable for these experimental recipes. Ordinary 5060 Ti generation remains unchanged. A separate lower-memory runtime and real 16 GB inference qualification are required before enabling it here. Copying models alone would not be sufficient.

Video recipes require 5–15 seconds; the author's unsupported 2–4-second Pika range is not silently run. Qualification covered five seconds at 0.2 MP. Larger/longer settings remain experimental and may fail resource or quality requirements. DenoMix and cinematic show **draft** dimensions followed by their real 2x output, rather than misleadingly labeling the final output as the draft resolution.

### Completed inference evidence

Every video below has 120 delivered frames at 24 FPS, five seconds of real native content and an audio stream. Only excess native frames are trimmed. No repeated-frame padding, optical-flow interpolation or artificial speed change was used. Times exclude admission queue wait but include fresh-worker initialization, loading, inference and delivery. Operating-system caches and disk contention differed, so these are qualification observations, **not a speed leaderboard**. Peak memory is sampled whole-device usage, including resident contexts, not an exact private-process allocation.

All paths in this table are relative to `testing-qualification/` under the evidence root; videos are named `result.mp4`, Director output `result.json`. Sibling files preserve graph, settings, model/reference hashes, status, logs and media probe.

| Check | Evidence directory | Output | Total seconds | Sampled GPU MiB |
| --- | --- | --- | ---: | ---: |
| Pika text | `a1bf11b5-44ee-4d13-8422-f1ef64cf4bbe` | 608×352 AV | 56.888 | 23,726 |
| Pika reference | `c3a70e1c-a6d7-44c5-895e-10869236ea04` | 608×352 AV | 382.957 | 23,808 |
| Pika first-frame image | `5193c4aa-9a29-4714-8ddb-3fe314af0aa8` | 608×352 AV | 297.945 | 23,808 |
| Original Standard Turbo reference | `61c5b8b4-5036-4029-99d7-a7265db2d87b` | 608×352 AV | 401.695 | 23,800 |
| Character regeneration | `2e6ff871-fe70-4c2c-b4d8-3c2510ccd1db` | 608×352 AV | 107.433 | 23,822 |
| Cinematic x2 | `4bcbee2a-ee71-4447-8d52-13150184b129` | 1216×704 AV | 81.796 | 23,322 |
| DenoMix 8+2 | `55d2333b-1558-4208-9cb1-aa9e4ad1807a` | 1216×704 AV | 363.752 | 23,784 |
| Local Director | `fa3af690-a03d-4900-9427-3134d57fae5e` | Three-shot JSON plan | 44.281 | 5,182 |

Pika reference → comparison Pika, and character-regeneration → Pika edit, were separately checked for exact graph equivalence (checkpoint alias only). These are documented equivalences, **not additional rendered outputs**. SLA and SoL execution were confirmed in sampler logs, not merely node registration. DenoMix logs show the 8+2 schedule, 38×22 → 76×44 latent lift, proper temporal chunking and audio/video decoding.

Non-explicit, authorized café references were reused from the prior benchmark. Spot-reviewed frames show recognizable curly-bob/ivory-sweater styling in Pika and DenoMix. Character regeneration changed the person to the braided/green-jacket reference, but also changed the setting. These are visual spot checks, not proof of temporal identity stability or perceptual audio quality. No subjective quality scores are invented. Director language can be awkward and should be reviewed before use. Its revision retained the two named characters and clothing and changed the setting to rainy evening, but introduced a "cello hum" despite the natural-sound direction. This is a real semantic limitation, not a transport or structured-output success that should be called perfect instruction following.

During qualification, the two ordinary 3090 ComfyUI services were restarted **outside this task** at approximately 03:04 EST. One private character run stopped safely on loss of the queue-health connection, and two subsequent attempts refused before inference. All three failure records remain. After normal services were healthy, only those affected checks were retried. This task did not restart ComfyUI, reset a GPU, or clear owner queues. The normal worker PIDs changed during that external event; they must not be reported as unchanged over the entire experiment.

### Software and real browser verification

- Full regression: **2,492 passed, one pre-existing live-worker test skipped**, no failures (`regression-final.log`).
- 31 offline graph, worker-safety and activation tests passed. TypeScript and the isolated Next.js build passed.
- Exact-build workspace browser suite: authorization, owner separation, safe HTTP request IDs, uploads/download hashes/ranges, playback, saved plans, archive/restore, cancellation and 412px layout passed without page errors (`build-qP6mjc/browser-q6VfOC`).
- Exact-build billing regression: eight checks passed, no page errors (`build-qP6mjc/browser-fedC51`). These use synthetic fixtures, not paid OpenAI billing calls.
- Actual UI → API → GPU → private media: two references entered Pika conditioning, producing 608×352/120-frame AV in 65.203 seconds. Non-secure HTTP browser submission, playback and download passed. File: `build-qP6mjc/real-testing-uCnNDv/actual-pika-two-reference-5s.mp4`.
- First actual UI Director plan completed in 41.971 seconds; the contextual revision completed in 42.177 seconds. The first revision check exposed a **test-selector** issue: raw implicit-label text included the saved textarea contents. The correct accessible textbox role/name was verified, the harness was corrected, and the same disposable session was resumed without rerendering the successful video or first plan. Original failed-test evidence is retained. Final revision/JSON/download/reload and post-launch-overlay mobile/desktop interaction checks all passed with no page errors; results and screenshots are in that directory.
- These are desktop Chrome and mobile-viewport tests using disposable accounts. They do not claim a new physical Android-device acceptance test.

### Runtime, licensing and changed files

Testing uses its own `testing-runtime.json` and content-addressed private engine. The already-working H3 Admin `runtime.json` and pinned engine are not replaced. A broken Testing runtime fails closed without disabling H3 Admin. Shared physical-GPU fencing, real queue/VRAM/RAM checks, cancellation ownership and cleanup-before-publication remain mandatory. Source and output media are private and non-destructive; there is no promotion endpoint.

Downloaded assets are checksum-verified against pinned revisions: Pika-Labs/Pika-H3-Flex `3ff166447d5edb1406107ab8370c42000ce173e4`, Deno2026/MiniMax-H3-DenoMix `489aa1513a65fd188fd0a043c9da2eac10587910`, Kijai acceleration/refiner `f5c3b1d5a63e008a691fca1b6096fd57a5307536`, DMD `bb2bc497cbaca89dadd0bcf1856eed4f8275be20`, and 3D lifter `0371b31652c7a3a60d4a59f047e871e4dcc43c15`. Exact filenames, bytes, SHA256 and private-node fingerprints are in `testing-qualification-runtime.json` and the installed candidate. Existing base H3, encoders, VAEs, RealESRGAN and Qwen weights are reused read-only.

H3-derived weights retain their publisher terms; the owner's stated permission is recorded for private evaluation, not independently reviewed commercial clearance. The adapted DenoMix workflow's GPL-3 terms, private node MIT/Apache-2 terms, RealESRGAN BSD-3 terms and Qwen Apache-2 terms must remain attached to any future redistribution review. No commercial deployment or blanket model-license equivalence is asserted.

Changes for this follow-up:

- `lib/experiments/generation.ts`: separate Testing runtime, variant/mode gates, qualified dispatch, Director JSON assets and owner/session-scoped revision context; independent failure isolation from H3 Admin.
- `lib/experiments/catalog.ts`, `store.ts`: accurate experiment names/limits, method variants and defaults.
- `app/app/components/ExperimentLabPanel.tsx`: real execution, method choice, actual recipes, 2x dimensions, Director plans/revisions, receipts and supported-GPU feedback; existing HTTP UUID repair preserved.
- `app/api/experiments/route.ts`: correct Director and spatial-refinement export manifests.
- `testing_graph.py`, `testing_runner.py`, `director_runtime.py`, plus narrow `h3_runner.py` extension hooks: fixed reviewed graphs, isolated GPU lifecycle and local planning. The live H3 Admin engine remains pinned to its existing copy.
- `prepare-testing-qualification.py`, `install-testing-runtime.py`: reproducible requests and evidence-gated installation.
- `qa-real-testing.mjs`, `test_testing_graph.py`, `tests/experiments-generation.test.ts`: real/browser and focused regression coverage.
- `activate-test.py`, `stage-test.cjs`: separate-runtime backups and exact-build real-inference qualification gate; ordinary application and billing safeguards preserved.

No GitHub push or PROD promotion is authorized by this follow-up. A later owner decision is required before any experimental recipe becomes a normal app feature.

### Live activation and owner walkthrough

- Active TEST release: `/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T091024Z`.
- Verified process PID `3020517`, cwd and pointer match that release. Both experiment and billing markers report build `59rXFcAoizfRlkKTOe_Yj`. The experimental JavaScript chunk fetched through HTTP matches the qualified release bytes.
- Backup: `activation-backup-20261102T091147Z-30d66ca8` under the evidence root. Ten ordinary TEST SQLite databases, the private experimental database and protected configuration were snapshotted. No migrations or database restoration occurred.
- Only `otg-test.service` was restarted for activation. PROD PID `481925`, Build 2.20 pointer and health 200 remained unchanged. The 5060 worker PID `399809` and post-external-restart 3090 worker PIDs `2960252` / `2960254` remained unchanged by activation.
- Local and tailnet health and both tab pages returned 200; anonymous experiment and billing APIs returned 401. Authenticated workflows were tested on the exact build with disposable fixture accounts, not by forging an owner login on live TEST.
- H3 Admin runtime SHA256 remains `255ef2af00afaf622307a74ff17d94b006f44c8c4fc3dff94e5d9a970d3954ab`. Testing runtime and all pinned engine files passed integrity verification.
- All three normal queues were empty and every inspected private job was terminal with cleanup confirmed. No experimental GPU worker remained; the 3090 reported 1,143 MiB whole-device usage and 0% utilization at final verification. This is a point-in-time observation, not a promise that later owner jobs will remain idle.
- Machine-readable proof: `post-activation-verification.json`; runtime installation proof: `testing-runtime-installation.json`, both under the evidence root.

Open **`http://100.75.162.64:3001/app?tab=testing`** as an administrator and refresh once if an older tab is open. Choose an experiment, click **New test plan**, enter a prompt, and start at **five seconds / 0.2 MP**. For image/reference/edit modes, attach files and select the appropriate source checkboxes; use the displayed numbered reference tags. Generate, monitor or cancel in that same session, then play/download the actual result and its receipt. The two-reference Pika clip in the real-browser evidence is an example, not an asset silently added to an owner's gallery.

For **Pika versus original H3**, keep the same saved prompt, references, seed and dimensions, switch only the method, and generate each separately. Results remain in the session for side-by-side review. For **Director Studio**, enter a concept, generate a plan, then revise the concept and generate again; only that session's last completed plan supplies context. Review generated wording before using it in a video prompt.

If application rollback is needed, this guarded command restores the prior HTTP-fix release without deleting media, models or evidence:

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/experimental-tabs-20261102-iszHqvZP/activate-test.py --rollback
```

It requires the exact current pointer and idle workloads. It does not restore old databases or change PROD. The newly installed Testing runtime remains retained on disk but is not used by the older planning-only Testing implementation.

---

Historical status before the generation follow-up: the isolated workspace was implemented and browser-tested, but checkpoint downloads, exact graph validation and GPU inference qualification were still separate work. No model was then presented as runnable.

## Previous activation — combined planning workspace and billing release

Activated on TEST at 2026-11-02 02:27 UTC (November 1, America/New_York), following explicit owner approval. The earlier staged package was not reused because it would have omitted the newer billing fixes.

- Active release: `/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T022706Z`.
- Build ID: `2PNR5hmcAYLJgvP21z1Z5`; TEST PID: `2776157` at verification.
- Both experimental and billing release markers identify this same build. Billing runtime sources and the existing TEST environment/data links were preserved.
- Evidence: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-cpgpe4tL`.
- Backup: `activation-backup-20261102T022739Z-021ebda0` within that evidence directory, including ten consistent SQLite snapshots and protected configuration. No migrations or database restoration occurred.
- Full regression: 2,475 passed, one existing live-worker test skipped, zero failed. Next.js build and TypeScript checks passed.
- Exact combined-build browser qualification: ten workspace checks and eight billing checks passed; zero JavaScript page errors. Auth, owner isolation, real synthetic-media upload/download/playback, save/reload/archive, and 412px mobile layout were exercised on isolated fixture accounts and data. Billing fixtures were not live OpenAI cost/balance checks.
- Six offline activation tests and four billing-installer tests passed. Packaging now requires the workspace suite, plus the billing suite whenever preserving a billing-enabled release.
- Live local and tailnet TEST health and tab-page requests returned HTTP 200. Anonymous experimental and billing APIs returned 401. Both marker build IDs and live PID/cwd were verified.
- PROD stayed on Build 2.20 with PID 481925 and healthy status. The three ComfyUI worker PIDs remained 2337976, 2337978, and 399809; all queues were empty before and after activation.
- No GitHub push, PROD change, worker restart, experimental GPU generation, or paid API call occurred.

Administrator entry points on the tailnet:

- `http://100.75.162.64:3001/app?tab=testing`
- `http://100.75.162.64:3001/app?tab=h3-admin`

These are working planning/upload/comparison tabs, **not working experimental model-generation integrations**. Generation and promotion still reject requests until a separate execution adapter and exact-model GPU qualification are complete. Physical Android acceptance was not repeated in this activation; mobile browser viewport testing was automated.

If needed, the guarded application-only rollback command on shawn is:

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/experimental-tabs-20261102-cpgpe4tL/activate-test.py --rollback
```

It checks the current pointer and idle workloads, preserves live data, and restores the previous billing-only application release. Do not rerun the older activation command recorded below; that historical package is superseded by this combined release.

## Boundaries

Only TEST port 3001 can expose these routes. Both tabs require the existing administrator role. Server authorization protects every API and media request; hiding navigation is not the security boundary. Records and media are also scoped to their creating administrator.

No ordinary H3 workflow, default model, LoRA, generation setting, gallery, account, production release or ComfyUI service was changed. No GitHub push, driver change, package installation, paid API call or experimental GPU generation was performed for this workspace release.

The owner confirmed publisher permission for private TEST evaluation on November 1. This is recorded as the owner's statement, not independently reviewed commercial or redistribution clearance. The interface no longer reports that owner permission is missing.

## Implemented

The **Testing** tab contains separate entries for Pika H3 Flex, cinematic spatial refinement, H3 character swapping, SoL Refiner / DenoMix, Open-H3-Regenerate-2K, Pika versus existing H3, and Qwen-powered Director Studio.

**H3 Admin** opens the private NSFW model-testing workspace with the four exact selected versions. It does not replace Standard, either Singularity version, FastH3 or SelfLift.

Both tabs provide:

- Named, persistent research plans with editable prompts and review notes.
- Requested text, image, reference and video-edit modes; 0.2 / 0.6 / 1 MP; portrait / landscape; a 2–15-second slider; seed; Auto 3090-first or manual GPU preference. These are saved targets, not enabled generation controls.
- Model-specific recipe and compatibility notes. Unsupported eight-step acceleration stays disabled rather than silently choosing another checkpoint or adapter.
- Private reference and comparison uploads, validation, SHA256 identity, media playback and original-byte downloads.
- Side-by-side imported-media review with matching-time seek controls; no interpolation, upscaling or speed changes.
- Save, reset, reload, conflict detection, manifest export, archive and restore. Archive preserves all files.
- Clear distinction between imported comparisons, planning manifests and actual generation evidence.

The compact panels use lazy loading, labeled touch-friendly controls and expandable technical details. The React review and complete browser-to-API-to-storage checks informed these choices.

## Exact checkpoint inventory

| Choice | CivitAI version | Selected format | Size | Important compatibility finding |
| --- | --- | --- | --- | --- |
| PRISM-PIKA | 3441190 | INT8 | 18.8 GiB | Built-in Pika merge; do not blindly add the legacy Turbo or Realism LoRAs. Exact sampler/sigmas still need qualification. |
| H3 Eros Max beta 7 | 3429412 | INT8 | 21.3 GiB | Author specifies 12/3 shifts and eight-step acceleration. Current author README recommends VSA/90% sparsity and notes single-pass flicker; SLA must not be assumed equivalent. |
| DaSiWa Hybrid v4 | 3391862 | INT8 | 19.5 GiB | This is the regular checkpoint, not the separately released four-step v4 Turbo. Do not silently replace it with that version. |
| PinkCherry v1.8 Hybrid | 3391975 | INT8 | 19.6 GiB | Exact Ref2VA/FL2VA hybrid. AdaLN pruning and newer acceleration adapters require compatibility testing. |

Exact hashes and CivitAI filenames are pinned in `lib/experiments/catalog.ts`. The selected files total 85,114,470,888 bytes, or 79.27 GiB, per host. Their on-disk sizes do not establish VRAM requirements or usable generation performance.

Public author downloads with matching published SHA256 values were found for [PRISM-PIKA](https://huggingface.co/OliviaRossi/Minimax-h3_Singularity-x-10Eros-Max_PRISM), [Eros beta 7](https://huggingface.co/TenStrip/10Eros-Max), and [PinkCherry](https://huggingface.co/SexGod1979/PinkCherry-NSFW_MiniMax-H3). The [DaSiWa mirror](https://huggingface.co/jeuzu/Dasiwa_MiniMax_H3_V4_int8) is third-party, but its published file SHA256 matches the exact CivitAI selection. Downloaded bytes must independently match before loading.

Do not use the Eros beta7 fix1 file as an unannounced replacement for the requested beta7 version. The author's changed recipe and reported flicker are reasons for an explicit comparison, not evidence that our installed hardware has passed.

## Storage and safety

The workspace uses a separate private SQLite database and UUID-addressed media files under `/home/shawn-rochford/AI/runtime/test/experiments`. Its root must be canonical, private and owned by the service account, outside ordinary application/gallery data.

Limits are 200 plans per administrator, 12 files per plan, 128 MiB per file, 2 GiB per administrator, 16 GiB globally, and an 8 GiB free-disk reserve. Reservations prevent concurrent uploads from bypassing quotas. Failed uploads remove only their own new file/reservation. Symlink and hardlink checks protect storage and delivery. Same-origin writes, bounded JSON, MIME/content checks and byte-range validation are enforced.

Fresh storage checks found sufficient capacity on the 3090 workstation. The 5060 Ti fast volume had about 65 GiB free, insufficient for all four weights plus working space. Its bulk volume had about 1.4 TiB free. No models have been copied into a live ComfyUI library or deleted to make space. A later isolated 5060 runtime should use bulk storage and disclose HDD cold-loading costs.

## Verification

Evidence before the final wording-only permission update:

- Broad regression suite: 2,459 passed, zero failed, one existing live-worker test skipped.
- TypeScript checking and Next.js build passed.

Evidence for the final workspace build `8VUhD6uol6ugervWIfXQE`:

- Next.js build passed.
- 18 focused experiment tests passed.
- Authenticated, isolated browser checks passed for login, ordinary-user denial, admin navigation, seven candidates, four model selections, plan save/reload/export, real PNG/MP4 uploads, hash-matching downloads, byte ranges, playback, matched seeking, archive/restore and cross-administrator denial.
- Desktop and 412×915 mobile layout passed with no horizontal overflow or JavaScript page errors.
- Generation and promotion endpoints reject requests without submitting jobs.
- Six offline activation safety tests passed, including stale pointers, modified files, wrong host, wrong privilege, PROD boundary and superseded candidates. Existing audit activation checks also passed earlier.

Browser accounts, database and synthetic media were disposable local fixtures. These checks do not claim authenticated physical Android acceptance, AI quality, model loading, GPU performance or completed video inference.

## Historical packaging and blocked activation

The candidate is staged at:

`/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T015338Z`

Evidence, download preparation and guarded activation live at:

`/home/shawn-rochford/AI/research/experimental-tabs-20261102-ZqX1lsmp`

The original candidate ending `014250Z` was superseded before activation. It is marked `DO_NOT_ACTIVATE`, and its activation plan was retained under a superseded filename.

The guarded activator verifies all pinned files, exact current pointer, worker queues, unfinished TEST records and CPU/voice workload status. It preserves the existing environment and data links, snapshots TEST databases and configuration, restarts only `otg-test.service`, verifies the served build and live process, and can restore the previous application release. It never restarts ComfyUI or PROD. Database rollback is not performed.

At the latest activation attempt, the 3090 H3 queue contained an owner generation. Activation refused before changing services or pointers. TEST remained on `test3001-story-talkback-20261102T000207Z`, PID 2673057. PROD remained on Build 2.20, PID 481925, with HTTP health 200. Recheck these live identities before any later action; they are observations, not permanent configuration.

The historical guarded command was the following. **Do not run it now**: its expected prior release is stale and it lacks the newer billing fixes. Use the current activation record above.

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/experimental-tabs-20261102-ZqX1lsmp/activate-test.py
```

An activation success would expose the planning workspace only. It must not be described as completion of the model-generation request.

## Work still required

1. Complete all downloads and verify actual SHA256 values; retain pinned upstream revisions and provenance.
2. Prepare separate loopback-only workers, input/output/user/cache directories and narrowly allowlisted nodes. Reuse compatible existing runtime files read-only; do not edit live environments.
3. Use the existing shared physical-GPU admission authority so experimental jobs cannot race normal TEST/PROD jobs. Check real queues, VRAM and voice workloads before inference.
4. Build and validate each model's correct graph, including true reference conditioning, audio/video decoding, temporal framing, trimming and model-specific acceleration. Do not assume all four modes work for every checkpoint.
5. Run bounded non-explicit qualification jobs on idle GPUs, record settings/timing/memory/errors, verify actual media, and expose only supported combinations.
6. Add the experiment execution/cancellation/results path to the private workspace with durable idempotent jobs and owned-process cleanup. This execution adapter is not implemented in the current release.
7. Independently implement and test the seven research candidates. Their cards currently store ideas and comparisons; they are not seven working feature integrations.
8. Request a separate owner decision before moving any successful experiment into the normal TEST application, GitHub or PROD.
