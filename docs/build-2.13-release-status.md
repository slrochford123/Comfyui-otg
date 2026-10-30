# Build 2.13 — native images and explicit image-edit model selection

## Included

- Official local MiniMax H3 text-to-image as a separate H3 function. Existing H3 video checkpoints, LoRAs, attention and sampling mappings are retained.
- Fibo 2.0 Dev creation in Character, Asset and Background creators.
- Explicit Qwen 2.1 / Fibo selection for ordinary image editing: Generate, Gallery, character modification/completion, asset edits, background edits/Remove People and Story visual edits.
- Independent Fibo Turbo (4-step, CFG 1) and Dev (50-step, CFG 5) graphs with Euler/simple, the Fibo Qwen3-VL 4B encoder and Flux2 VAE. No Qwen Image Edit or H3 LoRAs are silently inherited.
- Owner-scoped native image jobs, authenticated outputs, exact output-node selection, Gallery copy/save-only retry, safe exact-job cancellation and shared physical-GPU queues.
- Actual model metadata on Story edit versions. Gallery image edits cannot inherit a stale first/last-frame video workflow.
- Existing private-research deployment policy permits these tools on the approved personal-research production instance. No end-user approval checkbox or permission bypass is added.

## Qualification and limitations

Source tests, optimized build, browser/API checks and exact-package verification are required before activation. Earlier real inference covered H3 image and Fibo Dev/Turbo on both GPUs; a subsequent real Android-sized browser Fibo edit completed through submission, inference, protected retrieval and Gallery save. These are not claims of universal image quality or installed-APK certification.

Fibo editing is currently qualified with one source image. Additional references are rejected, never ignored; use Qwen for multi-reference edits. Specialized OrbitSheets/character-card, camera-angle/360 and background-plate pipelines retain their verified Qwen-specific workflows.

Fibo weights are CC-BY-NC 4.0. Personal-research authorization is not commercial deployment clearance. Model weights, user media, credentials, databases, environment files and machine-local research evidence are not published with this source release. Optional 8B Fibo prompt-enhancement weights are not required or installed by this release.

## Guarded deployment

Production must not switch until the exact Build 2.13 commit/build ID is live on TEST. The owner-run promotion validates model/runtime prerequisites, direct worker queues, shared GPU reservations, existing gallery mappings, protected settings, database preservation and HTTP gates. It snapshots and rehearses additive migrations before applying them, retains existing users/media, and rolls back the application without restoring databases on a failed activation.

Public release identity is stored separately from the large private artifact inventory, so the authenticated build endpoint can read the bounded, non-secret identity record. Promotion does not install packages, restart ComfyUI, change drivers or run GPU generations.

The application package version remains 2.0.1; the user-facing build/version-history label is 2.13. Actual activation remains a separately verified owner operation, not implied by source publication or staging.
