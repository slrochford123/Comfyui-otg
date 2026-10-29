# Build 2.12 — personal research production promotion

The owner authorized GitHub publication and guarded PROD promotion. Build 2.11 was verified live on TEST 3001: authenticated build identity, both-GPU readiness and Audio Editing returned 200. PROD was still Build 2.08/PID 106784 with health 200 before preparation.

## Deployment gaps corrected

The prior package's TEST-only switches would leave the requested features disabled on PROD. Build 2.12 adds explicit operator-only personal-research media enablement while keeping `OTG_ENV=prod`, normal authentication and existing user permissions. There are no new content-approval checkboxes, acceptance steps, account changes or production qualification-policy imports.

TEST and PROD now use one persistent physical-GPU admission ledger on SLR. Their jobs, accounts, media and queue databases remain separate. SQLite grants are atomic and fenced, survive process/connection failure, and never expire merely because a client disappears. The durable application queue stores admission intent before requesting a grant. Ambiguous grants can be reconciled idempotently without submitting generation again. An executing job holds its reservation until backend evidence is terminal; failed release acknowledgement is persisted and retried. Old tokens cannot release another job's newer grant. Different GPUs may still run concurrently.

The authority is an isolated standard-library Python CLI, not a ComfyUI modification or new public network service. TEST uses its existing operator SSH connection to call it; PROD calls it locally as the unprivileged SLR operator. The original status-only reverse SSH key remains unchanged. Remote 3090 audio continues to use the separate restricted audio-only key. Local 5060 inference also uses an unprivileged forced-command worker through a new loopback-only key; original SLR authorized-key entries are preserved.

An independent private SLR research runtime holds production-specific audio configuration, cache and dedicated connection paths. Installed model weights and inference environments are reused read-only where practical. The existing root web service uses only system Python/FFmpeg for controllers and CPU media operations; model Python always executes as the unprivileged worker account on both GPUs. Root-side configuration and keys are installed into a separate root-owned protected directory during activation. CPU-only mixing/extraction/cleanup remain available; AI processing uses a qualified GPU rather than loading model code as root. No production Python environment, GPU driver, ComfyUI custom node or worker service is changed.

## Qualification

- Full contract suite, TypeScript, optimized build and targeted publication audit are required by packaging.
- Shared-authority tests use independent application queue databases: the second producer cannot execute until the first releases. Persistent/concurrent admission, idempotency and stale fencing-token denial are tested without GPU work.
- Exact built-app synthetic-worker HTTP checks cover authentication, Auto/Manual routing, owner cancellation, process restart and byte-exact delivery.
- An actual isolated SLR application running with **`OTG_ENV=prod`** completed upload, soundtrack extraction, queued real MossFormer2 restoration on both GPUs through the configured unprivileged transports, session reconciliation and authenticated output downloads. Both 2-second stereo outputs were preserved; both authority reservations were confirmed released before QA shutdown.
- The final restricted-transport private-app trial took 8.26s on the 3090 and 27.56s on the 5060. These are short technical inference checks, not quality rankings, matched cold/warm benchmarks or proof that every model has identical performance. The additional local isolation changes transport and cache initialization costs; earlier native-worker timings are not an equivalent steady-state comparison.
- Production environment guards allow only six explicit new media runtime settings. Existing auth/settings cannot change; unfinished jobs, unknown outcomes and pending GPU releases refuse activation. Original database rows are compared after migration rehearsal/application. Existing gallery credentials, LoRA catalog and sampled media are preserved.

Prior per-engine inference and quality evidence remains in `unified-audio-validation.md`. This deployment change does not claim a new full AuK/ACE/Woosh quality campaign, Android login certification or commercial model-license clearance. The owner declared personal research/testing; third-party license notices remain in effect.

## Guarded activation order

1. Stage the exact qualified build on TEST and PROD without switching either service.
2. Owner runs the supplied guarded TEST command on **shawn / the 3090 PC**. It adds only the shared authority configuration and restarts only `otg-test.service`, retaining TEST data/auth and a rollback record.
3. Owner runs the supplied guarded PROD command on **SLR / the 5060 Ti PC**. It independently authenticates to TEST and verifies the exact version, commit, build asset and shared authority identity before stopping anything.
4. PROD activation verifies package/runtime pins, public/origin health, native queues, durable jobs and resource admission; backs up protected configuration and consistent databases; rehearses additive migrations; preserves original rows and runtime links; applies the six allowlisted media settings; switches only the application pointer and `otg-prod.service`; then verifies process identity, environment, public health, gallery and media retention.

Failure restores only the previous application and owned override, never database snapshots. If new or unverifiable work appears after the switch, rollback pauses rather than interrupting it. No worker/GPU restart, queue deletion, broad cancellation, package installation, or model change is part of activation.

## Remaining compatibility limits

The capability-aware mappings and exceptions in `media-gpu-routing.md` remain: unsupported legacy Manual GPU selections are not silently substituted; both-busy Auto remains prepared-job/sticky assignment; some older synchronous service endpoints can still encounter long-queue HTTP timeouts. This release fixes coordinated admission and production enablement, not universal support for models missing from a GPU. Truly unknown backend executions retain their reservation for exact-job reconciliation. Chat, Storyboard and Story Creator routing are unchanged.
