# Build 2.10 — checkpoint and production release gates

October 29, 2026. The owner authorized versioning, GitHub publication and production promotion. This updates the earlier publication holds; it does not make unqualified features production-ready or override model licensing.

## Source checkpoint

Build history advances from 2.09 to **2.10**. Package semver remains 2.0.1, independently of the owner-facing build number. Prior build history is retained verbatim.

The branch contains Unified Audio Editing, native Comfy API lifecycle hardening and media GPU routing. Research evidence, runtime environments, model weights, credentials, user databases/media and private activation backups are not source changes and must not be published.

Validation for this checkpoint: 2,078 contract tests passed, no failures, one opt-in check skipped; TypeScript and staged whitespace checks passed. A targeted publication audit inspected the three unpublished implementation commits plus staged changes without finding token/private-key patterns, model weights or runtime artifacts. This scan is not a guarantee against every possible secret. The built-app harness also checks authenticated build identity and Audio Editing availability so the lost-bootstrap regression cannot pass GPU-only HTTP qualification unnoticed.

The fresh optimized build passed, retaining a pre-existing named-package-export warning in `buildIdentityServer.ts`; lint was skipped by the existing build configuration. Eight exact-built-app HTTP checks passed with synthetic workers: authentication, Build 2.10 identity, retained Audio Editing availability, idle-3090 Auto, busy-3090 fallback, pinned Manual queue/owner cancellation, restart recovery without duplicate submission, and byte-exact gallery delivery. No GPU inference or production operation was performed for these checks. Evidence: `/home/shawn-rochford/AI/research/media-gpu-routing-20261029-v0Jb4nMQ/`.

## Live qualification finding

The owner activated `test3001-media-gpu-routing-20261029T200353Z` on TEST port 3001. PID/cwd/executable, `/app`, health and authenticated build identity verified Build 2.09. Authenticated `/api/media-gpu` reported enabled and both GPUs idle. No generation was submitted during this check.

Authenticated Audio Editing returned HTTP 400 because the standalone media packager omitted the existing audio release's TEST-only startup prefix. The source packager now reapplies `audio-editing-release-bootstrap.cjs`, preserving its `OTG_ENV === 'test'` guard and release-local worker path. Regression tests verify TEST setup and unchanged non-TEST environments. The serving immutable release is not edited in place; this correction requires a fresh built release and guarded TEST activation.

## Production blockers

Owner clarification: SLR Studios is for personal research and testing. The commercial-use licensing concern is therefore not being treated as a deployment blocker for that declared scope; published license conditions still apply. A server named PROD is not automatically a commercial service. No paid licensing request or permission document is required from the owner for this research-use deployment.

- `mediaGpuRoutingServer.ts` and `mediaGpuQueue.ts` intentionally require TEST; deploying identical code does not enable the new production queue.
- Unified Audio operations intentionally require TEST, and the installed inference/transport paths belong to private TEST runtimes. Deploying this UI unchanged without a production runtime would expose nonfunctional controls.
- The installed AuK pipeline uses a research/non-commercial Qwen encoder; installed Woosh weights are recorded as CC-BY-NC-4.0. Keep their notices and research-use scope; this is not a finding of commercial clearance. It is not a blocker to the owner's declared personal research/testing use.
- Existing adapter coverage, both-busy Auto assignment, cross-environment admission and legacy synchronous queue limitations remain documented in `media-gpu-routing.md`. Versioning or pushing a branch does not resolve them.

Do not supply a PROD activation command that silently leaves requested features disabled, breaks existing audio tools, points PROD at TEST data/runtimes or removes safety gates merely to get an HTTP 200. Preserve existing PROD until these release gates are resolved and the resulting exact build passes TEST qualification.

## Read-only privileged readiness check

Build 2.10 is now active on actual TEST 3001, PID 1123712. Authenticated build identity, GPU readiness and Audio Editing availability all returned HTTP 200 after activation. This is endpoint availability proof, not new inference-quality certification.

PROD is still on `slr`, Build 2.08, PID 106784. Its existing reverse-3090 connection configuration lives in root-only environment references; direct SSH from the ordinary SLR operator account did not authenticate. That does not establish that PROD's existing root connection is broken. It requires inspection using its actual credentials before selecting a transport implementation. No SSH keys, permissions or services have been changed.

`scripts/deploy/check-private-research-readiness.py` performs this root-only inspection without deployment. It reuses only the existing PROD SSH target/key/config for a bounded read-only Python/filesystem probe on shawn, checks local audio runtime paths, native queues, PROD health, and unchanged PID/pointer/config hashes. It does not install packages, initialize models, generate content, modify credentials or restart anything. It writes only a private diagnostic next to the script. A successful diagnostic is not activation; production-specific runtime/queue changes still require implementation and qualification.

## Evidence

Live authenticated check: `/home/shawn-rochford/AI/research/build-2.10-checkpoint-20261029-zuXmn9qx/live-test-qualification.json`.

Earlier exact-build and model results remain in `unified-audio-validation.md`, `comfy-api-reliability.md`, `media-gpu-routing.md` and their linked local research directories. Historical statements about activation/authorization in those chronological reports are superseded by this status note, not rewritten as if earlier validation occurred on the current live release.
