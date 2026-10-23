# H3 Auto/Manual Phase 3 — source candidate and qualification preparation

2026-10-23. TEST only; this document supersedes Phase 1/2 implementation descriptions where they differ. No activation, model installation, GPU execution, paid API call or PROD access is part of this phase.

## Preserved boundary

- Source: `/home/shawn-rochford/AI/runtime/promotion-major-20261022-DHQ6ZH/source`, branch `test/h3-auto-manual-20261023`, base `754c15f99bd4f0d92459a594eb61e36b3a316a19` plus preserved dirty H3 Trim/Admin and Auto/Manual work.
- Live rollback release: `test3001-h3-trim-admin-center-20261022T194500Z`, `otg-test.service`, port 3001, Node 22.23.4. Packaging does not switch it.
- Pre-correction source recovery: `/home/shawn-rochford/AI/research/h3-phase3-20261023-y8YGow/source-before-phase3.tar.gz`; archive SHA256 `2d37bd9f88f336702b00a5d2f76ce646b1d72ee6cf01a8d451d67e86a5c4014a`; source-manifest SHA256 `9094bc05fc62621566c5b53886420a028c4577f0a8cdbfc25bdf7e2aeb613301`. Earlier Phase 1 rollback is retained. Recover source only into a separate approved directory; never reset the dirty checkout or restore runtime data from a source archive.

## Phase 2 corrections

| Finding | Phase 3 implementation |
|---|---|
| Legacy advanced studio visible under Auto | Auto owns the simple form; the legacy tools are retained only under Manual. Parent busy state prevents overlapping UI submissions. |
| Workflow/checkpoint changes retain incompatible settings | One reconciliation function updates profile, sampler/steps, checkpoint, Combat, original audio and compatible optional stack before strict parsing. |
| Director chooses too little and sees only media counts | Full strict registered plan plus camera/motion; qualified capability allowlist; validated reference metadata; at most three consented small image/video-frame samples. Audio bytes are not sent. |
| Same-count reference replacement keeps reviewed plan | Server UUID, content SHA256, record version, roles, order, description, audio inclusion and selected video window bind the review. Actual bytes are checked again before execution. |
| Reusable proof too broad | Exact bound graph SHA256 and a separate versioned reusable configuration fingerprint. Every execution-affecting profile/dependency is represented. |
| No secure first-run path | Owner-only local CLI, separate asset-prepare and single-use execution approvals, exact request/source/GPU/config binding, mutex-time admission, output probe, telemetry and manual Android playback acknowledgement. No HTTP bypass. |
| Unknown submission or repeated Cancel can be misleading | Durable acceptance identity, cancelling until backend confirmation, exact-client read-only reconciliation and no automatic resubmit of ambiguous acceptance. |
| New generation might touch the other worker | New Studio filters to RTX 3090, rejects non-3090 resume and disables idle-peer release. Legacy H3/Production policy is not silently rewritten. |

## Auto Mode

Default controls: description, optional image/video/audio references, quality, aspect, duration and audio preference. Local planning is free and deterministic, not AI inference. It selects a registered T2V/I2V/R2V/reference-edit family from actual source topology. The plan preview includes availability and measured generation cost/time where evidence exists; generation requires its own explicit consent.

Optional paid Director uses the existing server-only OpenAI provider, budgets/rate limits/kill switch, strict Responses schema, token cap, `store:false` and no automatic retries. A short-lived, single-use quote binds exact media/configuration/qualified capabilities and estimate. Media-content sharing has a separate opt-in. The Director cannot invent graphs, paths, workers or unsupported parameter combinations. A clarification or unavailable response is not executable. A Director plan can be moved into Manual and re-reviewed.

No new configuration has physical qualification yet, so a paid call or normal generation is intentionally unavailable until legitimate evidence is recorded. This is not a claim of live AI/GPU acceptance.

## Manual Mode and workflow matrix

Manual includes workflow/checkpoint/profile, ordered optional LoRAs (at most three), enabled state and supported strengths, category/search across all 60 selected versions, seed, camera/motion, audio, first/last/reference roles, account-scoped device presets, graph inspection/export, Safe Cancel, reconnect/history and reviewed Retry.

Sampler, scheduler, steps and FPS are shown as profile-derived values, not arbitrary active controls. Unsupported 4-step, alternate attention implementations, guides/control/masks/continuation remain unavailable with explanations. Singularity retains automatic Realism; Combat V2 remains independent where compatible.

| Family | Native | Ref2VA 8-step | Inputs | New-controller duration |
|---|---|---|---|---|
| Text to Video, FL2VA | implemented | incompatible, disabled | description | 5 or 10 s |
| First/Last Frame, FL2VA | implemented | incompatible, disabled | first image, optional last | 5 or 10 s |
| Reference to Video, Ref2VA | implemented | implemented, exact adapter required | registered image/video/audio references | 5 or 10 s |
| Reference-guided edit, Ref2VA | implemented | implemented, exact adapter required | one source video, optional images | 5 or 10 s |
| Existing structural Fun ControlNet edit | preserved independently | existing policy unchanged | trimmed/direct video | existing 2–10 s |

All **new** matrix entries are source/schema tested, not physically qualified. Quality sizes are 608×352, 1056×608, 1344×768, with portrait transposition. Native uses 20 steps/res_multistep/simple; matching Ref2VA uses 8/Euler/simple, not an FL2VA substitute. Project SLA or explicit dense attention is fingerprinted. Temporal-grid excess is deterministically trimmed. Original audio follows a genuine source-audio mux path; generated/mute are separate paths. No structural Fun ControlNet relabeling occurred.

## Media, authorization and cancellation

- Media storage is owner- and session-scoped, bounded, unpredictable and expiring; API responses contain authenticated URLs, never filesystem paths. Real image decoding/video probing rejects unsupported or hostile media.
- Preview/execution bind the exact ordered media fingerprint. The reviewed execution receipt retains prompt, seed and graph settings, normalizing only uploaded file bindings/output prefix. Changed estimates also require a new review.
- Copies used by a job are rehashed before upload and again inside the submission mutex. Cross-owner assets, arbitrary paths, stale plans and generic Retry bypasses are rejected.
- Cancel records intent while acceptance is pending, never claims backend termination prematurely. Exact-client queue/history reconciliation recovers late acceptance without another submission. Ambiguous recovery remains blocked instead of risking duplicates. Existing worker-wide interruption safety remains in force.
- New Studio routes are authenticated and TEST-only. The local qualification flag cannot confer admission from JSON or a restarted web process.

## Two qualification identities

The full graph digest covers the compiled job with exact bound inputs. The reusable fingerprint normalizes legitimate job-specific prompt/seed/media filename values but includes template/compiler identity, model SHA256/bytes, all graph execution settings, dimensions, orientation, duration, sampling, attention, native/Turbo adapter, ordered optional stack with enabled states/strengths, implicit Realism/Combat, reference topology and audio path. Different stacks or profiles do not inherit a pass.

Separate owner-only provenance and installed-file stat receipts prevent expensive model hashing on ordinary API previews. Runtime proof requires completed real output, fixed 3090 identity, final graph artifact, actual runtime and memory samples, output dimensions/duration/hash and explicit physical Android playback acknowledgement. An asset hash receipt is not runtime qualification.

## First controlled qualification procedure — NOT executed

1. Finish/review the frozen candidate. Activate TEST only after separate approval; no shared worker restart is requested.
2. Run `scripts/h3-studio/prepare-first-cases.cjs --owner <actual-account-key> --research-root <owner-mode700-directory> --models-root <actual-installed-model-root>`. This only creates two unqualified proposals and a deterministic CPU QA reference image. It does not hash model weights, fetch workers or execute a graph.
3. Review exact installed paths, all upstream/adapter rights and a realistic capacity budget. The owner H3 attestation is recorded as private TEST owner-attested authorization, not independently verified documents or automatic permission for third-party LoRAs.
4. After explicit hash-preparation approval and both 3090 queues idle, use `qualification.cjs --proposal <proposal> --prepare --approval <mode600-prepare-approval>`. This hashes only selected dependencies, records inode/size/time receipts and provenance, never a runtime pass. Save separate private inventory/evidence files and configure their variable names: `OTG_H3_STUDIO_INVENTORY_FILE`, `OTG_H3_STUDIO_EVIDENCE_FILE`.
5. Recompute the proposal with actual inventory/capacity. Review the exact source revision, request digest (including prompt/seed and input hashes), configuration fingerprint, actual GPU UUID and one-hour-expiring single-use execution approval.
6. Only after separate GPU authorization, invoke `qualification.cjs --proposal <proposal> --execute --approval <execution-approval>` from an interactive owner terminal under the exact frozen source, Node 22.23.4 and TEST configuration. It checks both 3090 queues/processes, acquires existing physical admission, revalidates inside the mutex, never switches to 5060 Ti or frees the peer worker.
7. First run: Native T2V, landscape, 0.2 MP, 5 s, no optional stack. Review output and physical Android playback before accepting evidence. Second: Ref2VA 8-Step R2V, same size/duration and CPU reference, only after reviewing the first result and separately clearing the exact adapter. Do not assume 1 MP or portrait is qualified.
8. Failures retain private graph/telemetry/error artifacts and no pass. Output is held from automatic Gallery publication during local qualification. Successful acknowledgement records only that tested configuration; additional audio paths/LoRAs/profiles need their own evidence.

The preparation and execution commands above are procedures for later approval, not commands executed in this phase. No synthetic capacity/model hashes or fake qualification evidence are created.

## Model reconciliation and approvals

See [category batches and exact versions](H3_PHASE3_MODEL_BATCHES.md) and [machine-readable proposal](H3_PHASE3_MODEL_BATCHES.json). The snapshot retains 60 SELECT, 4 MAYBE, 76 SKIP and 13 UNDECIDED. Seven distinct selected versions were listed across both workers; six on each. Listing is not local-hash, rights or runtime verification.

- 53 proposed new files: 15,200,132,452 declared bytes, approximately 14.156 GiB.
- One separately proposed PBR transfer from 5060 Ti: 155,110,376 bytes, version 3240881. No transfer occurred.
- Filename conflicts held: 3294020 Crash Zoom, 3390388 Extreme Enduro, 3385432 Frozen World. No aliases/overwrites were made.
- Exact Ref2VA 8-step is listed on both hosts; this phase does not claim its hash or runtime proof. No substitution with FL2VA.
- Future batches require fresh storage checks, exact source SHA256 verification, per-entry rights review and explicit download/transfer approval. MAYBE/SKIP/UNDECIDED are not approved batches.

## Verification, packaging and rollback

Final logs/manifests are stored privately under `/home/shawn-rochford/AI/research/h3-phase3-20261023-y8YGow`. No-cost tests use temporary data roots and mocked external APIs/workers. CPU FFmpeg tests validate original/generated/mute audio and duration. Mocked browser geometry covers Auto/Manual × Light/Dark × 360/390/768 widths; representative 390×844 screenshots were inspected. This is not physical Android acceptance.

`scripts/h3-studio/package-test-candidate.cjs` requires a pre-build complete-source receipt, a subsequent matching standalone build, exact Node/native probes, fixed TEST paths and an unchanged rollback pointer. It stages a unique additive release, recovery-source, hashes, environment/data symlinks and copied guarded TEST activation helpers. It never restarts a service or switches a pointer. An incomplete package retains `DO_NOT_ACTIVATE`.

The successful candidate's `OWNER_TEST_ONLY.md` contains exact forward/rollback commands. The helper changes only TEST's current release pointer and managed TEST Node override, verifies effective ExecStart, `/proc/PID/exe`, CWD, native modules and health, and rolls the application pointer back on failure. Runtime data is never restored from a stale source snapshot. PROD and GitHub are separate, ungranted approvals.

Remaining acceptance gates: asset preparation/rights review, single-use GPU qualification, optional paid Director test, separate TEST activation and physical Android acceptance. No 100% runtime certification is claimed by this source candidate.
