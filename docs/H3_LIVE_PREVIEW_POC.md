# H3 Live Preview — TEST Proof of Concept

Status: software path implemented behind `H3_LIVE_PREVIEW_ENABLED`; no inference benchmark or PROD change performed.

## Audited capability

- Both installed ComfyUI backends advertise `supports_preview_metadata`.
- ComfyUI sends binary event type 4 with JSON metadata containing `prompt_id`, followed by JPEG/PNG bytes.
- Both current cores define MiniMax H3 as a 24-channel latent format and include Latent2RGB factors.
- RTX 3090 has `models/vae_approx/taeh3.safetensors` and core `taeh3` support.
- RTX 5060 Ti has core `taeh3` support but no `taeh3` decoder asset in its current `vae_approx` directory.
- Neither current service launch command explicitly enables `--preview-method taesd`; the safe no-install baseline is core Latent2RGB.
- Existing third-party H3 preview implementations are installed on the 3090, but they are not installed or enabled by this project.

## POC architecture

1. The application opens a dedicated outbound WebSocket session to the selected ComfyUI backend before submission.
2. The same generated `client_id` is used for `/prompt`, so ComfyUI returns that job's progress/preview frames to the application session.
3. The accepted `prompt_id` is bound to the owner-scoped application job.
4. Binary preview metadata is checked against the exact stored prompt ID.
5. Only the latest frame is retained in memory.
6. Owner-authenticated Server-Sent Events notify the correct browser that a frame changed.
7. The browser requests the owner-authenticated frame endpoint and displays it as **Approximate Preview**.

Preview failure is isolated from generation: a WebSocket connection failure falls back to normal generation with no preview. The authoritative job state remains in the existing direct JSON or Production SQLite job store.

## Feature flag

`H3_LIVE_PREVIEW_ENABLED=1`

The flag is intentionally off by default until controlled TEST renders validate both workflows.

## Remaining controlled benchmark

Before production readiness, run an identical approved H3 prompt on each backend with preview off and on, recording:

- peak allocated/reserved VRAM
- wall-clock sampling and total generation time
- count and usefulness of preview frames
- cancellation latency while preview is active
- final output integrity

Then separately assess TAESH3 on each backend. The 5060 decoder asset must not be added until its provenance/checksum and impact are reviewed. No large style-preview batch is part of this benchmark.
