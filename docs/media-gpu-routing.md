# Unified media GPU routing — TEST candidate

Date: October 29, 2026. Historical implementation and qualification record; not a claim that every legacy tool is dual-GPU capable. The owner subsequently activated the 2.09 media candidate on TEST. See `build-2.10-release-status.md` for current activation, packaging repair, publication authorization and unresolved production gates. Earlier activation/publication holds below describe the state when those checks ran.

## Requested policy

- Image, video and audio generation/editing: Automatic prefers an idle, compatible RTX 3090, then an idle, compatible RTX 5060 Ti.
- Manual pins the requested GPU. Unsupported selections must fail clearly, not substitute another GPU/model.
- Serialize rendering on the physical card, including the two different 3090 Comfy ports and isolated audio subprocesses.
- Keep Qwen chat, Storyboard and Story Creator routing outside this change.
- Preserve models, samplers, step counts, LoRAs, existing media and permissions.

GPU routing is independent of the H3 creative Auto/Manual mode; this does not add another creative Automatic workflow inside H3 Manual.

## Implemented

The shared compact Rendering GPU control provides Automatic/Manual plus the two GPU names, persists the preference in an enum-only cookie, synchronizes mounted controls, and displays live readiness/queue counts. It is shown on media surfaces, not Story Creator/Storyboard/chat. CPU-only mixing, extraction and conservative FFmpeg cleanup remain on CPU.

The SQLite media queue persists requests and a stable native Comfy UUID before returning application acceptance. A 202 response means accepted into the application queue, **not** already running in ComfyUI. The dispatcher probes the physical card, other Comfy lanes, voice reservations and existing resource locks before claiming a job. It holds a heartbeat-backed reservation until backend terminal evidence or completion of the isolated audio child. FIFO is per physical GPU; different GPUs may work concurrently.

Submission ambiguity retains the original UUID/reservation for reconciliation. It never automatically retries an uncertain POST or treats an expired process heartbeat as evidence that GPU work stopped. A queued cancellation uses a compare-and-swap before dispatch; running Comfy work uses the existing atomic per-job cancellation. There are no GPU resets, broad process kills or worker-wide interrupts.

Queue recovery starts with the application and after durable enqueue. A restarted application can resume queued native requests and reconcile accepted ones without changing prompt IDs. Legacy external services receive queued lifetime reservations, but their original service/result APIs remain responsible for operation results.

Owner-authenticated `/api/media-gpu` returns readiness, aggregate counts and only that owner's known jobs. Cancellation checks ownership. No raw graph, worker credentials, private paths or another owner's request are exposed by that endpoint.

## Adapter coverage

| Surface | Candidate behavior |
|---|---|
| Main Generate image/video | Capability-aware Auto/Manual selection before media upload; durable Comfy queue |
| H3 creative Automatic | Select and compile a compatible backend before creating the bound execution receipt |
| H3 manual Studio | Resolve the GPU before preview/review; do not change a signed plan after review |
| H3 direct, Edit Video, Body Swap, Realism, Ref Mods | Preserve existing per-GPU recipes; route explicit targets and serialize accepted renders |
| Character / Asset / Background image creation | Reuse the tool's model/node/LoRA checks; prefer 3090 among eligible devices |
| MOSS | Resolve GPU before building the GPU-specific graph; never point one GPU's model filenames at the other GPU |
| Unified Audio Editing | Qualified engines on either GPU; queued isolated child execution and existing remote transport |
| Legacy ACE, dubbing and IndexTTS/OmniVoice adapters | Queue supported 3090 operations; reject an unqualified manual 5060 selection |
| Other fixed Comfy media adapters | Serialize recognized media submissions; reject a conflicting manual target rather than silently ignore it |
| CPU-only media operations | Keep existing CPU execution, without occupying a GPU queue |

The generic transport is explicitly scoped; it does not enroll Story Creator/production orchestration or Qwen LLM jobs merely because they import a shared helper.

## Compatibility is not universal model support

The active capability manifest verifies both GPUs for several image workflows, including Z-Image Turbo, Krea 2 Turbo, Boogu Turbo and Create Anime Images. Other entries currently lack an approved fallback. For example, the manifest marks the 5060 Ti missing nodes for the listed WAN 2.2 workflows; Create a Picture has a verified 5060 mapping but a missing-model 3090 entry. These records are not silently upgraded by this change.

The installed private audio engine configuration records both GPUs for separation, AuK, music, effects and MossFormer enhancement. Those existing inference configurations and licensing restrictions are preserved. This routing task did not rerun every model's full inference/quality benchmark.

Older fixed-GPU tools are **not automatically ported** by changing an endpoint. Some retain only their configured, supported worker and now reject conflicting manual selections. Node/model inventory availability alone is not proof that another GPU can execute a tool safely. The old standalone Comfy voice mappings and fixed image-editing helpers still need a complete tool-by-tool dual-GPU audit before claiming universal coverage.

## Important remaining limits / release gates

1. **Not activated on live TEST 3001.** Current serving release remains the pre-existing Comfy API qualification release. OS sudo is unavailable in this session; no service restart was attempted or bypassed.
2. **Not yet a complete all-tools rollout.** Main integrated paths are covered, but legacy fixed-tool mapping qualification remains. Unavailable manual targets fail rather than being silently redirected.
3. **Both-busy Auto policy is currently sticky.** It queues on the priority compatible GPU after preparation, rather than migrating an already compiled/upload-bound job when a different GPU frees up later. A truly unassigned Auto queue would need to defer graph compilation/media upload until assignment. This is a remaining difference from a strict first-GPU-to-free policy.
4. **TEST and PROD are independent producers.** TEST's resource store is under its own data root. Direct worker/voice checks protect already observable work, but cannot atomically fence a simultaneous submission from the unchanged PROD app on another host. A single shared admission authority, or an equivalent coordinated worker-side gate, is needed before promising cluster-wide serialization across environments. No PROD services or workers were modified to hide this gap.
5. **Legacy synchronous endpoints remain synchronous.** Queue ownership is added to selected legacy audio services, but not every old endpoint has a durable user-visible job/result API. Long queue waits may still encounter caller/proxy timeouts; completing the asynchronous legacy adapters is a release gate.
6. Unknown backend outcomes intentionally retain reservations. They require exact-job reconciliation; do not clear them by deleting state or resetting a GPU.

For these reasons, leave this candidate isolated; do not activate it or promote it as the completed across-the-board implementation yet.

## Verification

- TypeScript check and optimized Next build: passed.
- Contract suite: 2,073 passed, no failures; one explicitly opt-in native check skipped by the normal suite.
- New routing/submission tests cover selection, physical-port serialization, independent cards, cancellation, persistence, unknown outcomes, credential-bearing transports and fixed-tool Manual refusal.
- Real built-app HTTP qualification with controlled synthetic workers: six full-flow checks passed, including authentication, Auto fallback, Manual pinning, ownership denial, app restart/no duplicate and byte-exact gallery download.
- Actual Comfy services on both PCs executed tiny 64px model-free image graphs using the reserved UUID and produced downloaded PNG artifacts. No model inference, paid API, cache-free request or interrupt was used for that proof.
- Browser: authenticated Automatic/Manual controls, 5060 selection carried into H3, Auto persisted after reload, Story Creator excluded; 412px responsive viewport had no horizontal overflow (397px client and scroll widths). The React review emphasized shared preference subscriptions and effect cleanup.
- Actual AI inference and every legacy adapter through live 3001: **not requalified** by these checks.

## Evidence

Final build and HTTP evidence:

`/home/shawn-rochford/AI/research/media-gpu-routing-20261029-6RcJ5y0y`

Native worker artifacts, browser-session evidence and earlier qualification attempts:

`/home/shawn-rochford/AI/research/media-gpu-routing-20261029-QPammGiK`

No version bump, GitHub push or PROD promotion was performed. Source changes remain recoverable against the pre-change Git checkpoint `5f2e9e5693c115cec2620df63c6f662691a64d5f`.
