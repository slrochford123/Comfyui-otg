# ComfyUI API reliability — TEST qualification

Date: October 29, 2026. This is a qualification candidate, not a production release.

## Scope and release boundary

Retain the native ComfyUI HTTP/WebSocket integration. Do not change H3 checkpoints, attention, LoRAs, steps, GPU routing, or workflow graphs. No cloud service, paid API, driver update, Python-environment modification, or ComfyUI restart is required by this patch.

The inspected source starts at `a4bf8f58870ee11cff91549e983b45d2a417d88c`, the separate Unified Audio TEST build. Active TEST was Build 2.09; PROD was Build 2.08. Preserve the audio workspace on TEST. Do not push that source ancestry or its experimental model configurations to production merely to deliver this API patch. An API-only promotion must be constructed against the qualified production baseline if the owner chooses that scope.

Versioning, GitHub push, and PROD activation remain gated on successful live TEST qualification and resolution of release scope. The candidate intentionally retains the existing build number until that gate passes. A staged artifact is not activation evidence.

## Implemented behavior

- Native JSON transport uses bounded requests including body reads, strict queue validation, caller cancellation, no redirects, and no automatic submission retries.
- WebSocket monitors reuse connecting connections, register a single message API, decode Buffer JSON and ArrayBuffer previews, reconnect with bounded backoff, and stop at a fixed lifetime. Old socket events cannot clear a replacement or resurrect a terminal job. Legacy untagged previews prefer the running job rather than a newer queued job.
- Submission metadata persists owner, original worker URL, client ID and node count. Progress rehydrates that attribution after application restart.
- Requested prompt IDs are owner-checked before backend access or gallery import. Historical collection cannot overwrite the currently active generation's owner state.
- The notification SSE route no longer relays a caller-selected raw worker socket. It uses authenticated owner progress, emits completion only after delivery, and cleans up its polling timer on disconnect. Progress remains recoverable independently of an Android foreground connection.
- Backend outages return a retryable reconnecting state rather than falsely declaring idle or terminating the render. Socket completion alone is capped below 100 percent until collection succeeds.
- Media retrieval rejects partial HTTP responses, empty and truncated bodies, redirects and stalled streams. Downloads publish atomically and retain file-format/hash validation. Gallery metadata without an actual file is not proof of delivery; partial imports do not mark the whole job done.
- Atomic per-job cancellation replaces the legacy worker-wide interrupt fallback. Pending-only deletion remains available on older workers. An absent prompt without queue/history evidence is not called successfully canceled. A worker without atomic running-job cancellation fails closed rather than risking unrelated work.
- Ordinary H3 now receives the durable acceptance/reconciliation protections previously restricted to Studio jobs. An ambiguous submission cannot be blindly retried. A failed application record with an original accepted job still running or ready to collect is recovered instead of regenerated. Missing original outcomes require reconciliation, not a new submission.

No generation-approval checkboxes, paid-service fallback, model substitution, or new content qualification restrictions were added.

## Evidence

Evidence directory:

`/home/shawn-rochford/AI/research/comfy-api-reliability-20261029-KGmqUuok`

- `contracts-final.json`: **2,056 tests passed, zero failures**, including the final accepted-job retry regressions.
- `build-final.log`: successful final standalone production-mode build, with disposable build-only auth material and isolated build data. `build-inputs.json` binds 1,548 frozen runtime/source/tooling inputs; their hashes were rechecked after building. The existing package-version named-import warning is not newly introduced by this patch.
- `http-qualification.json`: real authenticated HTTP calls against the built app, controlled synthetic native worker, actual H.264/AAC video bytes, binary preview delivery, dropped WebSocket recovery, upstream outage, range downloads, notification cleanup, application restart and no duplicate submission.
- `native-workers.json`: actual RTX 3090/5060 Ti native API responses, queues, registered H3/reference and preview nodes, and atomic-cancel no-op probes against never-submitted random UUIDs. Node registration is not represented as H3 inference certification.
- `test-candidate.json`: exact staged artifact and file hashes. `activate-test.py --check-only` validates integrity, environment/data links, durable jobs and idle workers without changing services.

Latest staged qualification release: `test3001-comfy-api-qualification-20261029T180815Z` (2,680 hashed files). It is **not activated**. The earlier `180215Z` candidate is explicitly marked `DO_NOT_ACTIVATE` because it predates the final accepted-job retry correction. No existing release was overwritten.

Activation command, on the `shawn` TEST/3090 host:

```bash
sudo /usr/bin/python3 /home/shawn-rochford/AI/research/comfy-api-reliability-20261029-KGmqUuok/activate-test.py
```

This restarts only the TEST web app after guarded idle/integrity checks, retains its current audio configuration/data, and has an application rollback. It does not restart ComfyUI or PROD, cancel jobs, restore databases, or push GitHub. After it runs, Codex must complete actual port-3001 qualification before any version/promotion decision.

The first broad contract run found stale legacy-audio UI assumptions and Build 2.08-specific test assertions. The legacy UI suite now explicitly selects its retained legacy mode; the build suite checks the actual current identity and append-only history. These are test corrections, not removal of coverage or changes to the audio implementation.

The HTTP fixture video has 24 native frames at 24 FPS, one second duration, H.264 video and AAC audio. The downloaded file was byte-identical. Synthetic worker fault injection verifies application transport/recovery; it is explicitly not an H3 GPU generation, performance benchmark, subjective quality review, or physical Android device test.

## API v2 decision

The optional official v2 proxy remains uninstalled and unused for live dispatch. Its architecture is not a multi-GPU scheduler, does not make upstream execution/history durable, and introduces another process and dependency set. Its default port also conflicts with the configured 3090 H3 port. The native hardening should be qualified first. Any future v2 trial must use a separate environment/unused port, preserve the native adapter, and prove operational parity before adoption.

Primary sources: [native messages](https://docs.comfy.org/development/comfyui-server/comms_messages), [API comparison](https://docs.comfy.org/development/run-workflows/overview), [self-hosted proxy](https://docs.comfy.org/development/comfyui-server/api-proxy), [proxy operational limits](https://github.com/Comfy-Org/comfy-api-proxy/blob/main/docs/batch-workloads.md).

## Remaining qualification gates

1. Owner runs the guarded OS activation command on `shawn`; this session does not have passwordless sudo. Do not bypass system permissions or restart the app by another mechanism.
2. Verify actual TEST port 3001: PID/cwd, release identity, health, authenticated request flow, protected output/download and notifications. Preserve live jobs; never reconcile them by force to activate.
3. Decide whether GitHub/PROD receives the API patch alone or waits for separate Audio acceptance/licensing clearance. No unaccepted or non-commercial audio configuration may be silently included.
4. Only after qualification: record the next build number, build and verify the exact release, push the intended source, then perform guarded PROD staging/activation with backup, idle checks and rollback.

This is not a blanket security audit of every historical media proxy or a promise that every custom workflow produces previews. Existing unrelated application/voice workflows are preserved; a broader raw-media authorization review remains distinct from these changed job/progress/transfer paths.
