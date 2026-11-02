# Experimental workspace TEST implementation

Status on November 1, 2026, America/New_York: the isolated workspace is implemented and browser-tested. The requested model-generation integrations are **not complete**. Checkpoint downloads, exact graph validation and GPU inference qualification remain separate work. No model is presented as runnable.

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

## Packaging and activation

The candidate is staged at:

`/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T015338Z`

Evidence, download preparation and guarded activation live at:

`/home/shawn-rochford/AI/research/experimental-tabs-20261102-ZqX1lsmp`

The original candidate ending `014250Z` was superseded before activation. It is marked `DO_NOT_ACTIVATE`, and its activation plan was retained under a superseded filename.

The guarded activator verifies all pinned files, exact current pointer, worker queues, unfinished TEST records and CPU/voice workload status. It preserves the existing environment and data links, snapshots TEST databases and configuration, restarts only `otg-test.service`, verifies the served build and live process, and can restore the previous application release. It never restarts ComfyUI or PROD. Database rollback is not performed.

At the latest activation attempt, the 3090 H3 queue contained an owner generation. Activation refused before changing services or pointers. TEST remained on `test3001-story-talkback-20261102T000207Z`, PID 2673057. PROD remained on Build 2.20, PID 481925, with HTTP health 200. Recheck these live identities before any later action; they are observations, not permanent configuration.

Once the queues are idle, the exact guarded command on **shawn / the 3090 workstation** is:

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
