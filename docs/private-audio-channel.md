# Build 2.11: dedicated research audio connection

The owner authorized a new audio-only SSH credential after confirming that the existing SLR-to-shawn connection is intentionally status-only. The original authorized-key entries are preserved byte-for-byte. A fresh probe also verified that the original process-status connection still works.

## Execution boundary

The new SLR-owned Ed25519 private key never leaves SLR. The shawn authorized-key entry restricts its source addresses, disables forwarding/PTY/agent features and forces `audio-editing-gateway.py`. This gateway accepts only the versioned `slr-audio-v1` JSON protocol. It does not evaluate SSH command text, shell snippets, caller-provided executables, configurations, remote paths or PIDs.

Input uploads are bounded, checksum-verified and job-local. UUIDs, file types, offsets, parameters and output indices are validated. Traversal and symlinks are rejected. Output download is limited to completed, worker-authored media assets and requires confirmed worker exit. Separate jobs/cache/configuration directories do not share app user data. Existing isolated inference environments and model weights are reused; no packages or ComfyUI custom nodes are installed.

Cancellation is cooperative and limited to the corresponding job. The restricted client retains its SSH supervisor until the remote worker acknowledges exit. An ambiguous submission persists a pending receipt; application reconciliation keeps the GPU reservation unknown rather than resubmitting or releasing it. If connectivity remains unavailable, operator reconciliation is still required; unknown does not mean failed.

## Host-aware application adapter

`localGpu` identifies the card on the application host. CPU jobs remain local. On SLR, 5060 Ti inference is native and the 3090 uses the restricted adapter. The old TEST configuration without `localGpu` still uses local 3090 and the existing qualified remote-5060 adapter. An explicit host configuration never silently reinterprets that legacy remote field.

The TEST bootstrap now preserves explicitly configured engine/worker paths and the existing disabled flag instead of overwriting them. This permits isolated SLR qualification without pointing a QA app at shawn-specific paths. Non-TEST startup behavior is unchanged.

Saved voice/character identifiers remain on the authenticated controller. Only their already-authorized session-local reference audio is uploaded for speech synthesis. The gateway does not expose a second voice/character library or grant media access.

## Evidence and limits

Private evidence: `/home/shawn-rochford/AI/research/private-audio-channel-20261029-1ude1930/`.

- Actual SSH denial checks: shell, command injection, SFTP, traversal, arbitrary file reads, caller PIDs and port forwarding rejected.
- Real CPU extraction: uploaded/downloaded checksums verified; one-second stereo retained.
- Real CUDA MossFormer2 execution: confirmed on each GPU, using original synthetic test audio. This is an inference/transport test, not a subjective restoration-quality evaluation.
- Real queued built-app processing on an isolated SLR loopback listener: authenticated upload, soundtrack extraction, 3090 remote restoration, 5060 local restoration, session reconciliation and authenticated downloads all passed. Two-second stereo preserved. Observed API operation/delivery times: 7.45s and 8.18s respectively; these are not a controlled performance comparison.
- Remote cancellation ended only the test job and recorded confirmed worker exit.
- Existing production release/PID and all ComfyUI service PIDs remained unchanged. Temporary QA processes stopped, all native queues empty, GPU allocations returned to baseline.

This is a **TEST candidate**, not production activation. Live TEST remained Build 2.10 during development; PROD remained Build 2.08. Production-specific enablement and shared TEST/PROD admission remain separate engineering/qualification gates documented in `build-2.10-release-status.md` and `media-gpu-routing.md`. Do not deploy this checkpoint alone and claim that all new production features are enabled.

Provisioning and qualification utilities never activate an application. Private key files, runtime configurations, authorized-key backups, model weights and user/job data must never be committed. The owner-approved GitHub branch is a source checkpoint, not a main-branch merge or deployed release.
