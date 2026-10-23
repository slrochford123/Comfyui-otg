# H3 Auto / Manual — TEST implementation and owner-review handoff

Date: 2026-10-23. Scope: **TEST source only, no runtime activation or GPU/paid execution**.

## 1. Runtime boundary and rollback

- Canonical active TEST: `test3001-h3-trim-admin-center-20261022T194500Z`.
- Service: `otg-test.service`, PID `1426508`, Node `22.23.4`, port `3001`, health/app `200` at preflight. No service restart, pointer switch or shared worker change was performed.
- Source: `/home/shawn-rochford/AI/runtime/promotion-major-20261022-DHQ6ZH/source`.
- New local branch: `test/h3-auto-manual-20261023`, based on `754c15f99bd4f0d92459a594eb61e36b3a316a19` **plus the existing uncommitted H3 Trim/Admin work**, which was preserved. This is not a clean commit or GitHub release.
- Before editing, saved the existing tracked binary diff and untracked source archive under `/home/shawn-rochford/AI/research/h3-auto-manual-20261023-MKFOqe/rollback/` with private permissions. No environment values were printed or added to source.
- The active release directory remains the verified runtime rollback point. Since this feature has not been activated, no runtime rollback is currently necessary. Do not reset the dirty checkout. Recover the saved source baseline in a separate approved working copy if needed, preserving the current work.
- PROD, its staging, databases, accounts, media and services were not accessed or modified for this task. No GitHub push, model installation/download/copy, node installation, symlink change, GPU job or paid OpenAI call occurred.

## 2. What is implemented

| Area | Implemented and no-cost verified | Not yet claimed |
|---|---|---|
| Auto controller | Default Auto selection, user intent, quality/aspect/duration/audio, free local plan, required-source question, structured director request, explicit planner estimate/consent, inspectable plan, transfer to Manual | Real paid director response or GPU result |
| Manual controller | Exact native family/checkpoint choices, selected 60-version catalog, categories/search, ordered stacks with strength/enable/remove/reorder, native vs matching Ref2VA 8-step, seed, explicit dense/project-SLA, independent Combat, account-scoped named device presets, sanitized inspection/export | Unqualified arbitrary sampler/steps/FPS/CFG/4-step profiles, guides/masks/continuation, or all 60 LoRAs functioning |
| Registry | Original 153-version decision ledger preserved; selected metadata enriches the existing writable canonical H3 policy store, not a second writable registry; exact upstream versions/files/declared hashes/license flags; separate installation/rights/runtime states | Full local hashes or license review inferred from a filename |
| Shared engine | Same `buildH3Workflow`, `H3DirectJob`, authenticated media routes, existing scheduling/GPU lease/progress/Safe Cancel/Gallery/history pipeline; the new plan is pinned to 3090 and revalidated before submission | A second independent engine or 5060 fallback |
| Editing | Separate reference-guided edit adapter derived from the supplied graph, source fit/pad, exact source/reference roles, normalized five/ten-second windows, generated/original/mute policies | Replacing or relabeling the existing proven structural Fun ControlNet editor |
| Audio | Real CPU FFmpeg tests prove source tone vs generated tone, mute, requested-duration trim and source-window retention | Full H3 audiovisual quality or lip sync |
| UI | Real React component in mocked Chromium at 390×844, Auto/Manual × Light/Dark, no horizontal overflow | Actual Android acceptance of the new release |

The existing full H3 tools and media controls remain below the new plan controller. The default controller is Auto, but this is a guarded integration over the existing studio, not removal of its tools or a claim that every historical panel has been replaced with the final simplified design.

The new reference-guided plan currently supports the shared engine's qualified-duration candidates **5 or 10 seconds at 24 FPS**. Existing direct **2–10-second structural Fun ControlNet V2V** remains unchanged. Other new-controller durations, arbitrary advanced values, P1 guide/mask/control/continuation features and optional acceleration profiles remain gated rather than silently normalized or claimed functional.

## 3. One canonical registry and deterministic compiler

- `lib/h3Stage1cLedger.json`: unchanged semantic owner ledger, including MAYBE/SKIP/UNDECIDED. It is not an install queue.
- `lib/h3Stage1cProvenance.json`: public exact-version filename, declared size/SHA256 and license-permission metadata for all 60 SELECTs. No model bytes or credentials.
- `lib/h3StudioRegistry.ts`: joins these records to `readH3LoraCatalog()` and the fixed 3090 worker inventory; no catalog write, sync, download or deletion side effect.
- `lib/h3StudioPlan.ts`: strict, versioned path-free input contract; unknown fields and workflow/adapter-family mismatch rejected.
- `lib/h3StudioCompiler.ts`: deterministic adapter above the existing compiler. No arbitrary client/AI graph, model filename, endpoint, cost or command can be submitted as a plan.
- Resolutions are precisely 608×352, 1056×608 and 1344×768; portrait transposes them. Legacy HQ 1376×768 is not globally changed.
- Frames are rounded up to `17k+5`; final CPU processing explicitly trims temporal-grid surplus to the requested five/ten seconds.
- Native: 20 steps, `res_multistep`, `simple`, project shifts 6/3; Ref2VA 8-step: exact matching adapter, strength 1, Euler/simple, shifts 12/3. No FL2VA substitution.
- The actual installed project node is `H3SLAAttention`. A dense choice explicitly disables its sparse path. No bypassed SolAttn, Sage or cache node is reported active.
- Singularity keeps the existing automatic Realism behavior. Combat remains independently controlled. Implicit LoRAs/encoder/VAEs require their own provenance/rights evidence too.

### Supplied source graph to reviewed API mapping

| Supplied UI graph | Existing engine / new adapter |
|---|---|
| VHS_LoadVideo 144 | Existing LoadVideo 60 + GetVideoComponents 61 |
| ImageResizeKJv2 158 | `studio_fit`, explicit aspect-preserving padding on CPU |
| MiniMaxH3ReferenceToVideo 136 | Existing conditioning node 39, source in `<Video 1>` |
| SamplerCustomAdvanced 125 | Existing sampler node 21 |
| VAEDecode 122 / VAEDecodeAudio 121 | Existing decode nodes 25 / 14 |
| VHS_VideoCombine 169 | Existing CreateVideo 34 + SaveVideo 5, then explicit audio/duration finalization |
| Stale UNET / encoder widgets | Exact server registry / existing qualified loader selections |
| Bypassed 199/204/195/142/197/198 | Not imported as active settings; actual project policy is applied deliberately |

The original 43-node attachment remains preserved, unmodified, in the private extracted handoff. Its personal sample prompt/media are not copied into the application API workflow or tests.

## 4. Availability and proof gates

No new configuration is currently marked executable based merely on old screenshots, an empty queue, metadata, node presence or a successful build.

`OTG_H3_STUDIO_EVIDENCE_FILE` is the **variable name only** for a future owner-controlled TEST qualification record. No fake file was created. The record must be versioned and identify `environment=test`, `target=3090`, upstream authorization reference, exact workflow/profile/attention/MP/orientation/audio/duration key, physical validation job, model SHA256, immutable template hash, measured cost/time, and each dependency's exact filename/hash/bytes/rights reference. Optional LoRAs additionally need exact Civitai provenance, family/strength evidence and existing canonical per-task policy approval.

New API routes fail closed outside TEST. New requests are authenticated, bounded, strict-schema validated, owner-scoped, and revalidated in the existing runner. The new public plan/graph does not expose filesystem paths or maintenance credentials. Reference-edit temporary source copies use the existing owner/session trim path and terminal cleanup; existing direct editing remains intact.

The owner's 2026-10-23 statement that they are authorized is recorded as **owner-attested**, not independently reviewed written authorization. It is not automatically a license grant for third-party LoRAs. Official upstream sources consulted:

- https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE
- https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/QA-about-License.md
- https://github.com/MiniMax-AI/MiniMax-H3
- https://developers.openai.com/api/docs/guides/structured-outputs

The structured director uses the existing server-only OpenAI provider/budget/rate-limit/usage path, strict Responses schema, token cap, no automatic retries, same-owner exact-input dedup/cache, and available registered IDs only. Free local planning is explicitly not AI inference. GPU-cost/time estimates are recorded measurements, never model-invented prices. Without a qualified capability/estimate the paid director cannot run from the new controls.

## 5. All 60 LoRAs and install proposal

See [H3_STAGE1C_INVENTORY_20261023.md](H3_STAGE1C_INVENTORY_20261023.md) for every version and per-host state.

- Six listed on each worker, seven distinct listed across both; 54 missing from the intended 3090, 53 absent from both.
- The exact Ref2VA 8-step is now listed and stat-readable on both hosts at 1,956,193,000 bytes. It was not copied or hashed during the busy owner workload.
- Three upstream/ledger filename conflicts are explicitly retained, not silently aliased.
- Proposed unique new download volume: 53 files, about 14.156 GiB, **not authorized or performed**. One additional 3090-needed PBR file already exists on 5060 Ti and would require separately approved transfer, rights and hash verification.
- No shared Comfy restart, custom node install, model movement or GPU rerouting is required/authorized by this source change. Do not infer safe 1MP reference-edit VRAM from file size; it remains a physical gate.

## 6. Verification

The pre-change baseline was 226 Vitest files / 1,198 tests and 47 Python tests. This change adds six test files and 104 tests. Final no-cost results:

- **232 Vitest files / 1,302 tests PASS**, supported single-worker deterministic mode; no skipped/failing tests reported.
- **47 Python tests PASS** (15 maintenance, 12 test-maintenance, 14 deployment, 6 Gallery agent).
- TypeScript PASS; Next.js production build PASS; Node 22.23.4 native SQLite in-memory and Sharp probes PASS.
- `git diff --check` PASS and whole-pending-file whitespace checks PASS, including untracked source.
- Credential-pattern scan: 65 pending source/document/test files checked, zero findings. This is a pattern scan, not a guarantee against all possible secret formats; no environment files or credentials were introduced.
- Four mocked 390×844 Auto/Manual × Light/Dark previews: scroll width 390, zero horizontal overflow; representative screenshots inspected. No physical Android acceptance is claimed.
- Final live TEST health/app 200, active service/PID/release unchanged. 3090 still had one owner job running; 5060 Ti queue was empty. Neither worker was reset or interrupted.

Focused coverage: strict schemas/injection, decision counts, model family, exact adapter, all MP/orientations, source roles, genuine audio routing, temporal frames, qualified dependency hashes, template provenance, no paid call without consent, planner dedup/owner isolation/outage, TEST/auth guards, byte limits/error sanitization, Auto/Manual transfer, and account-scoped presets. The full pre-existing regression protects existing H3/Scene Hunter/Production/Characters/Gallery/Edit Video/Admin behavior without spending credits.

No-cost UI evidence: `scripts/preview-h3-studio.cjs <absolute-output-directory>` uses the real React component with a mock catalog and installed Chromium, no application server or device session. Screenshots and geometry JSON explicitly say **mock desktop Chromium, not Android physical acceptance**. `scripts/audit-h3-stage1c.cjs` is read-only metadata inventory; no model download/install or Comfy mutation action exists in it.

## 7. Required owner approvals and remaining work

1. Approve a TEST-only release activation/restart after reviewing this source/build. Current TEST remains unchanged; no shared GPU restart is proposed.
2. Approve full-file hash/provenance verification when the current owner GPU/disk workload is idle, plus per-LoRA license/compatibility review. Do not infer all 60 are installed or usable.
3. Approve any exact download/transfer batch separately. Do not install MAYBE, SKIP or UNDECIDED entries.
4. Approve controlled real 3090 render qualification: native T2V, first/last I2V, R2V, reference edit; then exact Ref2VA 8-step, dimensions/orientations and source/generated/mute audio. Start small and measure actual RAM/VRAM/time/quality. Qualification of one architecture does not automatically cover unrelated combinations.
5. Approve at most one budget-consented paid OpenAI planner test; existing mocks do not prove a live response.
6. After approved TEST activation, perform physical Android acceptance, media handoffs, Safe Cancel/retry and result/Gallery/download proof. No fresh physical H3 result is claimed in this task.
7. Only then decide whether additional manual profiles/P1 workflows can be enabled. GitHub and PROD promotion remain separate, ungranted gates.

**Status: guarded TEST source implementation, not a fully qualified or activated H3 Auto/Manual release.** The full requested runtime/advanced-control rollout is not claimed complete while these gates remain.
