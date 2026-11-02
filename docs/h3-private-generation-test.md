# Private H3 generation — TEST qualification

Later follow-up: the separate Testing tab now has qualified private inference for six research entries. See [Testing execution, evidence and current activation](experimental-workspace-test.md#testing-execution-follow-up--november-2-2026). The H3 Admin runtime documented here was preserved byte-for-byte. Activation records below are historical and their rollback commands refuse a different current pointer.

Research date: November 1, 2026, America/New_York (November 2 UTC).

This is the execution follow-up to the earlier planning-only experimental tabs. **Activated and verified on TEST** at 2026-11-02 03:58 UTC (November 1, America/New_York). It does not replace ordinary H3 choices or authorize GitHub/PROD promotion.

## Implemented

The administrator-only H3 workspace now has a real execution adapter, not just saved plans. Each exact checkpoint is enabled only for modes with completed isolated qualification evidence:

- Text → video.
- Image → video with the selected image connected as a first-frame guide.
- Reference → video with real H3 reference-image/video/audio conditioning.
- Edit video: reference-conditioned regeneration, not frame-exact editing.
- Edit image: native H3 still-image latent sampling and PNG decoding. This is not video generation followed by frame extraction, and does not promise pixel-exact preservation.

The UI retains compact model/mode choices, 0.2/0.6/1 MP, orientation, 2–15-second video duration, seed, source uploads, source-selection checkboxes with numbered prompt tags, progress, cancellation, generated-media playback/download, comparison, review notes and receipts containing the actual graph. Still-image editing hides video duration and produces one PNG without audio. When mixing video and standalone audio references, it explains that H3 numbers video soundtracks first instead of displaying a potentially incorrect standalone audio ordinal.

The normal Testing idea cards remain planning/comparison workspaces; this change does not claim to implement those seven unrelated research ideas.

## Checkpoints and recipes

| Selection | Exact version | Steps | Sampler / scheduler | Attention |
| --- | --- | ---: | --- | --- |
| PRISM-PIKA | CivitAI 3441190, INT8 PikaFlex 0.85 merge | 8 | Euler / simple | Dense PyTorch |
| Eros Max beta 7 | CivitAI 3429412, original beta7, not fix1 | 8 | Euler / simple | VSA, 10% keep; dense below sparse threshold |
| DaSiWa Hybrid v4 | CivitAI 3391862, regular v4, not separate Turbo | 20 | Euler / simple | Dense PyTorch |
| PinkCherry v1.8 Hybrid | CivitAI 3391975, pruned INT8 | 20 | Euler / simple | Dense PyTorch |

All use CFG 1 and video/audio sigma shifts 12/3. No extra Turbo, Realism, Combat or quality LoRA is applied. PRISM's Euler recipe is an experimental hybrid configuration, not a claim that the publisher qualified this exact Pika sampler setup. SLA is not forced onto these checkpoints. PinkCherry's separate Turbo-LoRA branch and DaSiWa's separately published Turbo checkpoint are not silently substituted.

Shared encoder: `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`. VAEs: `minimax_h3_video_vae_fp16.safetensors` and `minimax_h3_audio_vae_fp32.safetensors`. Exact model file names, SHA256 and pinned upstream revisions are retained in the download evidence. Model bytes must match before qualification.

At 0.2 MP landscape the canvas is 608×352; at 0.6 MP it is 1056×608; at 1 MP it is 1376×768. Portrait swaps width and height. Video uses native H3 temporal framing at 24 FPS, then trims only excess frames. No padding, interpolation, spatial output upscaling or artificial speed change.

## Isolation and reliability

- TEST/admin authorization, same-origin mutations and per-administrator ownership checks protect APIs and media. PROD routes remain unavailable.
- Private database/media: `/home/shawn-rochford/AI/runtime/test/experiments`, separate from normal galleries and application content.
- Durable request UUIDs prevent accidental duplicate submissions on connection retry. Each request preserves immutable sources, hashes, settings, graph, logs and output receipt.
- A dedicated private queue and the existing shared physical-GPU admission authority coordinate with ordinary jobs. Each generation uses a fresh loopback-only worker with private inputs, outputs, user/cache/temp folders and only the reviewed LabMemory nodes.
- The existing ComfyUI environment, source and encoder/VAEs are reused read-only. Checkpoints live in the private research directory, not the live model library. No drivers, packages, system workers or production release are modified.
- Before generation: both 3090 worker queues must be idle, the shared reservation must be acquired, and at least 20,000 MiB VRAM and 34 GiB available RAM must be present. If ordinary work appears or available RAM drops below 4 GiB, only the private worker is stopped.
- Cancellation targets only the owned private worker. GPU leases are released only after process cleanup is confirmed. Missing heartbeats or uncertain cleanup fail closed rather than clearing queues or resubmitting automatically.
- Results are published only after successful decoding, media validation, checksum verification and confirmed worker cleanup. Source files are never overwritten.
- Limits: four pending jobs/admin, 48 retained research runs/admin, 12 assets/session, 128 MiB/asset, 2 GiB/admin and 16 GiB total media reservations. Job evidence is retained separately and consumes additional disk; admission keeps a free-space reserve.

## Hardware qualification boundary

Currently the private runner is qualified on the RTX 3090 only. Auto therefore chooses that qualified GPU; the 5060 Ti option is visibly unavailable rather than silently redirected. Existing 5060 Ti and regular H3 functions are untouched.

The four checkpoints total 79.27 GiB. The 5060 Ti fast volume lacked sufficient free space for all four plus working space; its bulk HDD volume has capacity, but no second copy or 16 GB inference claim is made. A separately qualified lower-memory/offloaded configuration would be required before enabling that GPU. Small tests already sample over 21 GiB of total GPU usage on the 3090, including pre-existing resident contexts, so copying files alone would not establish 16 GB compatibility.

The complete 15-second/1 MP range is exposed as experimental, not fully benchmark-qualified. Qualifying small jobs does not guarantee every duration/resolution combination fits or has acceptable quality.

## Actual inference evidence

Evidence root: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-p05Oh1Oy`.
Downloads and checksums: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-ZqX1lsmp`.

Each small qualification video is 2 seconds, 608×352, 24 FPS, 48 delivered frames, with audio. Every image edit produces a native 608×352 PNG. Each run starts its own process; disk/kernel caches may persist. Times include private-worker preparation, model loading, processing and delivery, excluding queue wait. These are qualification observations, not a controlled speed ranking. GPU memory is sampled every ten seconds and includes other resident contexts, so it is not an exact isolated allocation peak.

| Checkpoint | Text→video | Image→video | Reference→video | Edit video | Edit image |
| --- | ---: | ---: | ---: | ---: | ---: |
| PRISM-PIKA | 36.6 s | 42.7 s | 42.9 s | 56.9 s | 26.3 s |
| Eros beta 7 | 38.4 s | 42.7 s | 44.9 s | 58.9 s | 28.3 s |
| DaSiWa v4 | 52.4 s | 58.7 s | 62.9 s | 91.0 s | 30.3 s |
| PinkCherry v1.8 | 52.6 s | 58.7 s | 60.9 s | 88.8 s | 30.3 s |

All twenty checkpoint/mode combinations completed, plus the separate five-second actual-UI video: **21 real outputs**. Every completed private worker confirmed cleanup. `qualification-results.json` and `qualification-results.csv` in the evidence directory list exact output paths, settings, timings, sampled GPU memory and the earlier pre-inference validation failure. All four downloaded checkpoint checksums matched their selected versions.

The first PRISM graph validation rejected a string bit-depth value before inference. It was corrected to the node's integer enum value; the successful graph and subsequent outputs are retained. No substituted model or fabricated result is used.

A separate real application test used disposable administrator data and the built UI, actual API and production-shared GPU admission authority to generate an Eros two-reference video at 0.6 MP for five seconds. It delivered 1056×608, 120 frames at 24 FPS with audio in 142.424 seconds; playback, exact download and owner-scoped receipt retrieval passed. The worker log confirms two separate image conditioning blocks and actual sparse VSA execution (26,291 tokens). VSA warns that this checkpoint lacks `to_gate_compress` layers and uses its fine stage without a coarse branch; no hidden layer is patched or invented.

Actual UI result: `build-2LsYLD/real-h3-DY1z4F/actual-eros-reference-5s.mp4` beneath the evidence root. This UI build preceded only reference-tag wording/label improvements; the inference backend is unchanged.

### Quality findings, not guarantees

The tested PRISM, Eros, DaSiWa and PinkCherry image edits changed the woman's ivory sweater to blue while broadly retaining her face, curly hair, mug and café setting. This is not proof of pixel-exact editing.

The five-second Eros video preserved recognizable reference appearances but **duplicated Woman B**, producing a third person despite a two-person prompt. Both references really entered conditioning; successful inference does not establish reliable person-count or character-identity control. This concrete quality limitation is retained for owner review rather than hidden or scored as a quality success.

All qualification prompts/assets are non-explicit. No claim is made about performance on untested scene categories, long durations or complex choreography. No subjective quality scores are invented. Audio existence and stream metadata were verified; that is not a guarantee of perceptual sound quality.

## Software verification

- Full regression: 2,485 passed, one pre-existing live-worker test skipped; no failures.
- Focused private workspace/generation tests: 28 passed, including owner isolation, exact-mode/GPU gating, idempotency, immutable outputs, PNG delivery, cleanup gating and cancellation. A stale job marked completed without confirmed cleanup becomes needs-attention, not a published or automatically retried success.
- Eight graph tests, six private-worker safety tests and six offline activation-safety tests passed. Worker tests verify fail-closed queue checks, cancellation ownership and process-stop-before-reservation-release ordering.
- TypeScript and isolated Next.js builds passed.
- Browser fixtures verify authorization, source upload/hash/range/download, saved plans, archive/restore, compact desktop/412px layout, real job-API transport, receipt display, playback and cancellation. Synthetic-runner transport checks are explicitly separate from actual GPU qualification.
- Existing billing browser regression remains required before packaging, preserving the newer billing fixes.
- No paid API tests, GitHub push, PROD deployment or normal ComfyUI restart are part of this change.

## Activation and access

All four models are installed in the private runtime and qualified across the five modes. The exact final build passed both browser suites and was activated with the existing guarded TEST procedure:

- Build ID: `8gGhsdfbBnLXjgKGSMVb9`.
- Live TEST PID: `2898428` at verification.
- Release and verified process cwd: `/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T035740Z`.
- Rollback target: `/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T022706Z`.
- Backup: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-p05Oh1Oy/activation-backup-20261102T035816Z-e7d61501` (ten ordinary TEST SQLite snapshots, the private workspace database and protected configuration).
- Local and tailnet health, Testing page and H3 Admin page returned 200. Anonymous private-generation and billing APIs returned 401 as required. Experimental and billing markers identify the same final build; the active runtime passes all pinned engine hashes and exposes four models with five qualified modes each.
- PROD stayed healthy on Build 2.20, PID `481925`, unchanged release pointer. Existing ComfyUI PIDs remained `2337976`, `2337978`, `399809`; all three normal queues were empty. The 3090 returned to 1,545 MiB baseline GPU usage with no experimental worker allocation remaining.
- No migrations, GitHub push, PROD deployment, production service restart or normal ComfyUI restart occurred.
- Final exact-build browser suites: 12 workspace checks and eight billing checks passed with zero JavaScript page errors. Authentication and owner isolation were exercised using disposable fixture accounts, not the owner's live account. Physical Android acceptance was not repeated; the mobile test used a 412px browser viewport.

Post-activation evidence: `post-activation-verification.json` in the evidence root. The earlier candidate ending `034710Z` was never activated and is marked `DO_NOT_ACTIVATE`; its original packaging plan and helpers are retained as superseded evidence.

If required, application-only rollback on shawn is available through:

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/experimental-tabs-20261102-p05Oh1Oy/activate-test.py --rollback
```

It requires the exact current pointer and idle workloads, preserves live data and restores the previous planning-only application. It does not delete downloaded models or private generation evidence and does not restore stale databases.

After activation, open `http://100.75.162.64:3001/app?tab=h3-admin`, select a model, create or load a plan, choose mode and settings, attach/select source references when required, check the displayed numbered tags, enter the prompt, then use Generate. For image editing, select Edit image and one source image. Generated outputs and receipts appear in that same private session.

Further integration into ordinary TEST, GitHub or PROD requires a separate owner decision. The owner's stated publisher permission is recorded for private evaluation; it is not independently verified commercial or redistribution clearance.

## HTTP browser compatibility hotfix — November 2, 2026

The Android screenshot exposed a client-side regression: the experimental panel
called `crypto.randomUUID()` directly. That API is absent on non-secure HTTP
origins such as the TEST tailnet IP. Localhost browser tests had concealed it
because browsers consider localhost a trustworthy origin even over HTTP.

The panel now uses the existing `newClientRequestId()` helper: native UUIDs when
available, otherwise cryptographically secure `getRandomValues()` with RFC 4122
version/variant bits. It does not use `Math.random`, change authentication, or
weaken request deduplication. Unsupported browsers without secure randomness fail
before submitting anything. This is a browser compatibility repair, not a change
to model recipes or GPU routing, and does not enable the separate Testing ideas.

Evidence root: `/home/shawn-rochford/AI/research/experimental-tabs-20261102-Qswe4R9D`.

- The prior build reproduced the exact error on a non-localhost HTTP browser
  origin resolved only to the isolated loopback fixture server.
- New exact build: `IUY65XvTY2y_9mB_xp1yF`; 2,488 tests passed, one existing skip.
- Workspace browser regression verifies `isSecureContext=false`,
  `typeof crypto.randomUUID=undefined`, and actual generation submission, polling
  and playable output without modifying browser crypto. Billing browser checks
  remain passing. Fixture media is explicitly synthetic, not model inference.
- Separate real inference through that same non-secure, 412px browser flow:
  Eros beta 7, two source references, eight Euler steps, VSA, 1056×608, five
  seconds, 120 frames at 24 FPS, audio retained. Total 142.522 seconds; sampled
  peak GPU allocation 23,720 MiB (whole-GPU measurement). Worker cleanup verified;
  GPU returned to its 1,545 MiB baseline. No physical Android test is claimed.
- Actual video: `build-agLKXY/real-h3-VXEYYV/actual-eros-reference-5s.mp4`
  beneath the evidence root. Receipt/results contain the exact hashes and graph.
- Test coverage also checks retrying a lost response reuses its request identity,
  accepted runs receive new identities, and missing secure randomness fails closed.

The hotfix was activated independently of the pending Testing-tab GPU expansion.
At 07:13 UTC, TEST PID `2911165` ran the exact release
`test3001-experimental-tabs-20261102T071031Z`. The HTTP-served client chunk matched
the qualified build byte-for-byte. Both tab pages and health endpoints returned
200; unauthenticated private APIs returned 401. PROD PID `481925`, its Build 2.20
pointer, and all three ordinary ComfyUI PIDs were unchanged; queues were empty.
See `post-activation-verification.json` in the evidence root.

Recoverable backup: `activation-backup-20261102T071306Z-737c7ac7` in that same
evidence root, including TEST databases and protected configuration. Current
application-only rollback is `sudo -n /usr/bin/python3
/home/shawn-rochford/AI/research/experimental-tabs-20261102-Qswe4R9D/activate-test.py
--rollback` (one shell command). It requires the exact current pointer and idle
queues, restores the preceding real-generation release, and does not restore
stale databases. No production or GitHub change is included.

## Changed implementation areas

- `app/app/components/ExperimentLabPanel.tsx`: real generation controls, native image-edit mode, source selection/tags, GPU/recipe qualification, job polling/cancel, receipts and generated previews.
- `app/api/experiments/route.ts`: qualified generation, cancellation, private job/result polling and owner-scoped graph receipts; promotion stays disabled.
- `lib/experiments/generation.ts`: durable private jobs, fixed runner dispatch, integrity/qualification gates, idempotency, quotas, cleanup-aware result publication and stale-worker handling.
- `lib/experiments/catalog.ts`, `store.ts`: native image-edit mode, generated-asset role and failed-reservation accounting; existing owner isolation retained.
- `scripts/experiments/h3_graph.py`, `h3_runner.py`, `LabMemory/__init__.py`: exact fixed graphs, real native still/reference/video conditioning, isolated worker lifecycle, GPU admission and memory cleanup within that worker only.
- `prepare-h3-qualification.py`, `install-qualified-runtime.py`: reproducible evidence requests and hash-pinned activation from successful receipts, with uniquely named runtime backups.
- `qa-real-h3.mjs`, `qa-browser.mjs`, `qa_fake_runner.py`: separate real-model end-to-end proof and explicitly synthetic browser-transport testing.
- `tests/experiments-generation.test.ts`, `test_h3_graph.py`, `test_h3_runner.py`: execution, media-type, graph and worker-safety regression coverage.
- `scripts/experiments/activate-test.py`, `stage-test.cjs`: private-job activation guards, private-database/runtime backups and accurate release markers. Existing combined billing qualification gates are preserved.
- This report and `docs/experimental-workspace-test.md`: current evidence and historical planning release distinguished. Previously dirty billing QA and packaging work was preserved rather than reset.

## Approved-account H3 integration — November 2, 2026

This section supersedes the administrator-only navigation instructions above for
the new TEST entry. The old administrator research URL remains supported for
existing bookmarks; ordinary users cannot use it.

### Delivered on TEST

- H3 now has **H3 NSFW** beside **H3 · Text to Image** for administrators and
  approved accounts. No new bottom-navigation tab was added; the previous H3
  Admin navigation item was removed. Testing remains administrator-only.
- Settings has **Request NSFW approval**, an adult/reference-rights acknowledgement,
  pending status and enabled status. Requesting access never grants it.
- Admin → Users has an **H3 NSFW** enable/disable switch, pending-request indicator
  and decline action. Administrators are always enabled. Every other account,
  existing or new, is disabled when no explicit grant exists.
- Approval is a separate entitlement, not an administrator role. Decisions are
  recorded with actor, timestamp and version in the private experiments database.
  Stale admin updates fail rather than overwriting another decision.
- Approved users get only their own private H3 sessions, references, results and
  receipts. Every API/media request checks current permission. Testing models,
  other users' media and administrator functions remain inaccessible.
- Model buttons preserve the current prompt, session and references when switching
  between the four private checkpoints. Old generation receipts retain the exact
  checkpoint and graph actually used.
- Generation modes: text-to-video, image-to-video, reference-to-video, edit video,
  and native still-image editing. Controls include 0.2/0.6/1 MP, portrait/landscape,
  2–15-second duration, seed, source selection, preview, download and cancellation.
- Native/Turbo buttons accurately show the available checkpoint-specific recipe.
  The LoRAs/advanced disclosure explains unsupported combinations rather than
  displaying nonfunctional active controls.
- Permission-aware workers recheck a versioned grant before and during execution.
  Revocation cancels that user's private worker through its normal cleanup path;
  other workers/services are not interrupted. Reapproval cannot revive an old job.
  Existing files are retained, not deleted. Already downloaded/browser-buffered
  bytes cannot be withdrawn; new media requests are denied immediately. The H3
  entry refreshes on focus and approximately every five seconds while visible.

### Qualification and boundaries

| Checkpoint | Available recipe | Optional alternatives |
|---|---|---|
| PRISM-PIKA | 8 steps, Euler/simple, dense attention | Other steps/extra LoRAs disabled |
| H3 Eros Max beta 7 | 8 steps, Euler/simple, VSA | Forced Native/extra LoRAs disabled |
| DaSiWa Hybrid v4 | 20 steps, Euler/simple, dense attention | Forced Turbo/extra LoRAs disabled |
| PinkCherry v1.8 Hybrid | 20 steps, Euler/simple, dense attention | Forced Turbo/extra LoRAs disabled |

The qualified graphs and model files were not changed. Earlier qualification of
the four checkpoints' five modes was retained; this update adds one fresh real
inference through the approved non-admin application path, not twenty new model
benchmarks. The isolated worker still supports only the RTX 3090. RTX 5060 Ti,
arbitrary LoRAs, SLA overrides, forced alternate recipes and maximum-size 15-second
performance are not newly qualified. They must not be advertised as verified.
The adult checkbox is an acknowledgement, not independent age verification or
commercial/legal approval. The owner's stated publisher permission has not been
independently verified. No explicit test media was generated.

### Test results

Evidence root:
`/home/shawn-rochford/AI/research/h3-nsfw-access-20261102-TzbkENPq`

- TypeScript check and isolated optimized build passed.
- Full regression: **2,496 passing tests, one existing skip, zero failures**.
- Python graph/worker safety suite: **27 passing tests**.
- Browser suites passed for the existing Testing workspace, the preserved billing
  interface, and the new permission flow. New-flow browser JavaScript errors: zero.
- Real browser authentication, Settings request, Admin Users grant/revoke,
  forbidden self-grant, cross-origin rejection, owner isolation, restricted model
  catalog, source upload/range/download, model switching, unsupported LoRA rejection,
  video playback/download, revocation, reapproval and retained results were checked.
- Mobile-size 412×915 and desktop 1440×1000 layouts were checked. This does not claim
  a new physical Android-device test. The existing non-secure HTTP UUID regression
  also passed, without a browser crypto polyfill.
- Fresh non-admin inference: **PRISM-PIKA, 2 seconds, 608×352, 48 frames, 24 FPS,
  8 steps; 36.473 seconds total; sampled whole-GPU peak 21,478 MiB**. Result and
  permission-stamped request retained. A contact sheet visibly shows the intended
  red paper boat; subjective overall quality is still for owner review.
- A second request was deliberately held behind a synthetic busy queue, then
  revoked. The real runner canceled and cleaned up without acquiring a GPU or
  generating another video. Offline checks also cover grant-version changes and
  missing entitlement records/databases.
- Two QA harness issues were corrected before success: waiting for the asynchronous
  admin-switch response, and preserving nanosecond model timestamps byte-for-byte
  instead of rounding them through JavaScript JSON serialization. The latter was
  caught before GPU inference; no model file was altered.

Successful permission-flow evidence:
`build-KnWQQn/browser-access-VtOtuF/results.json`

Video:
`build-KnWQQn/browser-access-VtOtuF/approved-user-h3-2s.mp4`

Contact sheet: `verified-paper-boat-contact.png`.
UI screenshots: `build-KnWQQn/browser-access-VtOtuF/nsfw-mobile.png` and
`build-KnWQQn/browser-access-VtOtuF/nsfw-desktop-result.png`.

### Activation and preservation

At 10:32 UTC, TEST PID **3039585** ran:
`/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T103011Z`

Build identity: **vQwXjeo_bJ0gSZlpSnFt2**. Local and tailnet health/pages returned
200, anonymous private APIs returned 401, and the HTTP-served NSFW client chunk
matched the qualified build hash. The permission-aware runtime was pinned and
activated transactionally with the application; the separate Testing runtime hash
was unchanged. Permission tables are additive/private and created on use; the main
account schema was not migrated.

Protected backup:
`activation-backup-20261102T103157Z-22e629c4` beneath the evidence root.
It contains ten TEST database snapshots, private experiments DB and configuration.
Read-only comparison confirmed all **80 account rows, 4 role rows, 9 private
sessions and 31 private asset rows** unchanged across activation.

Post-activation verification passed in `post-activation-verification.json`.
PROD stayed at PID **481925**, Build 2.20 pointer, health 200. Ordinary ComfyUI PIDs
**2960252**, **2960254**, and **399809** stayed unchanged. All queues were empty;
the qualification worker exited and GPU usage returned to 1,299 MiB. No GitHub push,
PROD deployment, version bump, driver/package change or normal model-library edit
was performed. All pre-existing dirty source changes were retained.

Guarded rollback, only if needed:

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/h3-nsfw-access-20261102-TzbkENPq/activate-test.py --rollback
```

It requires the exact current release/runtime and idle queues, restores the prior
TEST application/private runtime, and retains current databases and media. Do not
restore old database snapshots over new user work.

### Owner review

1. Refresh `http://100.75.162.64:3001/app?tab=h3`. As admin, open **H3 NSFW**.
2. Choose a checkpoint and **New generation session** (or an existing saved plan).
   Choose a supported mode, settings and prompt; attach/select references as needed.
3. Generate, preview and download the result. Existing administrator sessions remain
   available in the same private store.
4. Review **Admin → Users → H3 NSFW**. Enable only accounts you intend to approve.
   A normal user requests access at the bottom of Settings.
5. Review the still-separate Testing ideas at your convenience. Nothing is promoted
   automatically. GitHub/version/PROD promotion awaits your later approval.

### Files changed for this integration

- `nsfwAccess.ts`, `nsfwHttp.ts`, `/api/h3/nsfw/*`, `/api/admin/h3-nsfw-access`:
  explicit account entitlements, request/audit storage, fresh authorization and CSRF.
- `apiHandlers.ts`, `assetHandlers.ts`, original experiments routes: reuse of the
  existing validated private backend while keeping administrator and user scopes
  separate; no duplication of GPU recipes or media stores.
- `generation.ts`, `h3_runner.py`: permission-version stamping, guarded dispatch,
  fail-closed checks and owned-worker cancellation.
- `store.ts`: revision-checked model switching limited to the four H3 checkpoints.
- `H3Panel`, `ExperimentLabPanel`, `AppPageClient`, `SpinDialNav`,
  `H3NsfwAccessRequest`, `H3NsfwUserControl`, `useH3NsfwAccess`, Admin Users:
  conditional H3 entry, request/grant controls, private user presentation and
  revocation refresh. The React checklist guided lazy-loading and account-keyed
  component lifecycles; the end-to-end checklist required real API/data/GPU proof.
- Access tests, browser qualification, runtime preparation, guarded packaging and
  activation: reproducible verification and recoverable TEST-only release.

## Compact H3 user editor — November 2, 2026

This revision replaces the research-plan UI **only in the user-facing H3 NSFW
workspace**. The separate Testing and legacy administrator research screens remain
available. It does not add model support, change recipes or promote to PROD.

### User workflow

Open H3 → H3 NSFW. Choose Text, Image, Reference, Edit video or Edit image. Enter
the scene, attach references if needed, choose output settings and press Create
video / Create image. A separate "New generation session" step is no longer needed.

- Your scene has Clear text, Undo text, Enhance and Short/Medium/Long enhancement.
  Enhancement reuses the existing provider endpoint and billing/safety settings;
  failure leaves the original text intact. No uploaded file is sent to that
  endpoint by this editor.
- Uploads are automatically selected. Each reference has a preview, readable
  Picture/Video label, Remove and ordering buttons. Clear inputs and Undo removal
  operate on the reference selection, not the original files or generated results.
- Saved uploads can be added back. Reference selection/order is persisted with the
  draft and validated against owned, ready source files on the server. Generation
  must match the saved selection so a detached input cannot silently reappear.
- Drafts autosave with serialized revision checks. Late save/poll responses do not
  replace newer typing. New draft and saved drafts live in History & saved drafts.
- Resolution, duration, orientation, models and verified render mode stay visible.
  Seed, GPU selection, detailed qualifications, limits and instructions are inside
  Advanced settings & help. Unsupported render recipes/5060 Ti remain disabled.
- Latest output has a direct player and download button. Running jobs have Cancel;
  previous results and technical receipts are under History & saved drafts.
- Duplicate clicks are guarded; a lost generation response can be retried with the
  same cryptographically safe request ID, including on ordinary HTTP Android/LAN.

### Boundaries and validation

Evidence root:
`/home/shawn-rochford/AI/research/h3-nsfw-access-20261102-G5molKkd`.
It contains both HEAD and dirty-source backups. No model download, GPU inference,
paid enhancement request, access-policy change or production restart is needed
for this UI revision. Qualification scripts use disposable accounts/data and a
clearly labeled synthetic runner for media transport. Prior real GPU qualification
remains the evidence for unchanged models/recipes; it does not prove maximum
duration/resolution or 5060 Ti compatibility.

New automated coverage includes prompt undo/enhance failure, overlapping autosave,
model-switch preservation, remove/undo/persist/restore, foreign/pending/comparison
reference rejection, exact dispatch selection, HTTP UUID/idempotent retry, narrow
mobile layouts, private playback/download, cancellation and access revocation.
Build, browser and activation results are recorded separately in the evidence
root; source completion alone is not proof of live activation.

### Qualified build and results

Build **N2HypIFvxjV9BCwaXnzaq**, from `build-m1KHPa/source`, passed the optimized
Next.js build and TypeScript check. The compact component passes ESLint without
warnings. Whitespace validation passed.

- `regression-final.json`: **2,504 passed, 1 skipped, 0 failed**. An earlier run
  hit the existing 5-second limit in the real local-Python/shared-admission fixture
  and subsequent teardown-related failures. All assertions passed with a 30-second
  test timeout and explicitly isolated admission configuration; no queue production
  logic or assertions were relaxed.
- Python graph/runner tests: **27 passed**; unchanged GPU engine/runtime.
- `build-m1KHPa/browser-compact-vJ0V9v/results.json`: authenticated ordinary-user
  end-to-end UI, authorization, autosave, reference selection, history, synthetic
  generation transport, playback/download, cancellation and revocation passed.
  Screenshots cover 360px, 412px and desktop with no horizontal overflow.
- `build-m1KHPa/browser-2mxKJb/results.json`: separate Testing/legacy Admin workspace,
  ordinary-user denial, ownership, upload/range/download and HTTP crypto regression
  passed.
- `build-m1KHPa/browser-y3pHC5/results.json`: existing OpenAI billing UI/API regression
  passed without paid provider calls.

The UI tests caught and fixed a prompt Undo closure bug and an ambiguous saved-draft
accessible label. Browser assertions were corrected to expand collapsed history
and await asynchronous draft loading before evaluating the result. Earlier failed
reports remain in the evidence folder rather than being overwritten.

The exact 46,397-file candidate is staged at
`/home/shawn-rochford/AI/deploy/otg-test/releases/test3001-experimental-tabs-20261102T110350Z`.
The original TEST pointer was `test3001-experimental-tabs-20261102T103011Z`.
Activation is guarded by both application and worker idle checks. A first attempt
correctly refused because a new render arrived; the app and running render were not
interrupted. See `post-activation-verification.json`, if present, for actual live
activation and retained-data evidence, not this staging statement.

### Live TEST activation confirmed

At **2026-11-02 11:08 UTC**, all three direct worker queues were idle and the
guarded activation completed. TEST PID **3105519**, working directory/current
pointer and served build markers match the exact qualified candidate above.
`post-activation-verification.json` reports `ok: true`; the actual HTTP-served
compact UI chunk matches its release hash. Local and tailnet health/pages returned
200; unauthenticated private APIs returned 401.

The fresh protected backup is
`activation-backup-20261102T110823Z-8f574ef2` under this revision's evidence root.
It includes ten TEST databases, private experiments SQLite and configuration.
Read-only comparison verified **80 users, 4 role rows, 9 private sessions and 31
private assets**, plus both private permission tables, unchanged across activation.
The H3 runtime and separate Testing runtime hashes stayed unchanged. PROD remained
PID **481925**, Build 2.20, health 200; all three ordinary ComfyUI PIDs were unchanged.
No inference, paid provider call, version bump, GitHub push or PROD change occurred.

Refresh `http://100.75.162.64:3001/app?tab=h3`, then choose **H3 NSFW** to review the
new editor. The earlier owner-review instruction to create a generation session
first is superseded: enter a prompt directly, add inputs as needed, and Create.

If rollback is necessary, the exact guarded command is:

```bash
sudo -n /usr/bin/python3 /home/shawn-rochford/AI/research/h3-nsfw-access-20261102-G5molKkd/activate-test.py --rollback
```

It requires an idle TEST boundary and preserves current databases/media. Do not
restore old database snapshots over later user changes.

## Compact H3 random-seed revision — November 2, 2026

H3 NSFW now defaults to **Random seed each time**. **Lock seed** is visible
beside that status; enable it to reuse the current seed, or enter a specific
nonnegative number under Advanced settings & help. The preference is saved with
the draft. Old drafts without this preference start unlocked; their saved seeds
and historical receipts are not rewritten. New drafts start unlocked.

Each new generation allocates its seed once using Web Crypto, available on LAN
HTTP as well as HTTPS. It is saved before submission and copied into the existing
immutable job request and graph. A lost response retried without changing the
draft reuses the seed and request ID. A successfully accepted job ends that
intent, so the next Create click receives a fresh seed. Locking a seed does not
guarantee bit-identical results across different models, GPUs or other settings.

Scope is this compact H3 workspace only: normal H3, Testing recipes, permissions,
model files and GPU runtime configurations are unchanged. No inference or paid
API calls are needed to verify this seed-selection change. Browser verification
uses real private APIs/storage with a synthetic runner, not new model-quality
qualification. TEST activation remains idle-guarded; no GitHub push or PROD change.

Evidence root: `/home/shawn-rochford/AI/research/h3-nsfw-access-20261102-fwYaGP2D`.
`pre-seed-files.tar.gz` contains the affected original files from the preceding
exact qualified build. The broad working-tree snapshot overlapped the first edit;
use the explicit pre-seed archive for these files, not that broad snapshot.
`post-activation-verification.json`, when present and successful, is the live
activation proof; build/source changes alone do not prove activation.

### Seed revision validation and activation

- 2,511 regression tests passed, 1 skipped; focused seed/UI/store/job tests passed.
  TypeScript, focused ESLint and whitespace checks passed, as did 27 Python
  graph/runner tests. The UI fixture was corrected to mark synthetic unit jobs
  completed instead of filling the four-active-job limit.
- Exact Next build: `cJ2elvzxfjKuj6FdyBwGj`. Compact H3, legacy Testing/admin and
  billing browser suites all passed. The compact suite ran on non-secure HTTP
  with no `crypto.randomUUID`, checking fresh seeds, two locked-zero jobs,
  persistence after reload, unlocking, and a deliberately dropped accepted
  response that retried the same immutable job ID/seed. No page errors remained.
- The first fault-injection harness attempt failed because Playwright's request
  client does not inherit Chrome's test-hostname mapping. The harness now uses
  its authenticated loopback client before dropping the browser response. Only
  that non-bundled QA script changed after the successful application build;
  both source and package copies match. No application workaround was required.
- TEST activated at 11:27 UTC, PID **3125714**, release
  `test3001-experimental-tabs-20261102T112633Z`. The served client chunk, PID/cwd,
  pointer and markers match this build; private anonymous requests remain denied.
- Backup: `activation-backup-20261102T112703Z-4519dd44`. Read-only comparison
  verified all 80 users, 4 roles, 9 private sessions, 31 private assets and both
  permission tables retained. Runtime hashes and all three ComfyUI PIDs remained
  unchanged. PROD remained PID 481925, original Build 2.20 release, health 200.
- No live GPU inference, paid calls, version bump, GitHub push or PROD change.
  This validates seed controls and transport, not model output quality.

Refresh TEST H3 → H3 NSFW. Leave **Lock seed** off for automatic randomness;
enable it to keep the current number or edit **Advanced settings & help → Seed**.
Historical job seeds remain available in their technical receipts.

## Snapshot picker integration — November 2, 2026

The compact H3 NSFW References toolbar now includes **Snapshot**, reusing the
unchanged `VideoSnapshotPicker` from normal H3. Choose a local video, scrub to a
frame and select Use Snapshot, Use First Frame or Use Last Frame. Download
Snapshot remains available through the existing authenticated download route.

Only the bounded JPEG frame is uploaded to the private owner-scoped asset API;
the source video is neither uploaded nor changed. Reference and Edit video modes
append the frame. Image and Edit image modes replace the active image selection,
retaining the previous source in Saved uploads. Remove and Undo removal work with
snapshots, and selected frames persist with the saved draft.

The picker remains open if upload or save fails, permitting retry. Its controls
are disabled during insertion, and Escape/close cannot dismiss an ongoing upload.
Text-only mode does not offer reference capture. Normal H3, the shared picker,
permissions, seed behavior and model/runtime configurations are unchanged.

Evidence: `/home/shawn-rochford/AI/research/h3-nsfw-access-20261102-R1Kzkxts`.
The complete pre-edit dirty tree is backed up in `working-source-before.tar.gz`.
Browser verification uses a generated red/blue video to inspect real captured
JPEG pixels, first/last/scrubbed timing, aspect ratio, uploads/downloads, failure
recovery, reload, and the immutable job reference. Synthetic job transport is
explicitly not GPU inference. Activation still requires the idle guard and exact
snapshot-qualified browser build; no GitHub or PROD action is authorized here.

The first browser pass exposed two integration issues, corrected before release:
the modal was trapped below the app header by the H3 stacking context, and a quick
Remove → Undo could restore the saved draft while leaving its status label as
Unsaved changes. The private picker now portals to the document body, retaining
upload guards; the editor compares each change with its saved signature when
updating the status label. Tests cover modal hit-testing above the header and
the saved-status round trip. The shared normal-H3 picker itself is unchanged.

### Snapshot validation and live activation

- Final build `CIX9aELsEEaUrIMXYB-dc`: 2,518 tests passed, 1 skipped; TypeScript,
  focused ESLint and whitespace checks passed. Seven new snapshot integration
  cases cover all four image-input modes, errors, cancel and text-only exclusion.
- Exact-build browser evidence is under `build-WECdiu/browser-compact-WUb68F`.
  A 1920×1080 red/blue video produced 1536×864 JPEGs of the correct first, last
  and scrubbed frames. Pixel checks, actual snapshot download/upload, server
  persistence, reload, remove/undo and single-image replacement passed. Header
  hit-testing confirmed the modal controls are unobstructed. Capture created no
  GPU job; a subsequent synthetic job received the exact snapshot ID and hash.
- Existing compact seed tests, private access/revocation, legacy Testing/admin
  and billing browser suites also passed on that exact build. All browser work
  used disposable fixture accounts/data, not owner content or paid providers.
- Guarded TEST activation succeeded at 11:44 UTC: PID **3141383**, release
  `test3001-experimental-tabs-20261102T114349Z`. The actual served UI chunk matches
  the qualified package. Local/tailnet health, pages and authentication boundaries
  passed in `post-activation-verification.json`.
- Backup: `activation-backup-20261102T114420Z-9549184e`. All 80 users, 4 roles,
  9 private sessions, 31 private assets and permission records were preserved.
  Model runtime hashes, all three ordinary ComfyUI PIDs and PROD PID/release/health
  remained unchanged. No GPU inference, version bump, GitHub push or PROD change.

Refresh TEST → H3 → H3 NSFW. Choose an image-input mode and select **Snapshot**
in References. Choose a video, pick a frame and use it as the image input.
