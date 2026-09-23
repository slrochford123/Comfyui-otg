# FastH3 B02 Approximate Preview Validation Policy

Scope: TEST only. Canonical no-preview workflows remain the fallback source of truth.

## Output Safety Gate

Preview validation does not require exact decoded video frame checksum equality.

Runtime testing showed that FastH3 video output on this installed CUDA stack is
not bitwise/frame-checksum deterministic even across repeated canonical
no-preview runs with identical prompt, seed, and settings. This nondeterminism
is documented and is not treated as a preview failure.

Required gates:

- Identical workflow generation settings except the preview override insertion.
- Identical output resolution.
- Identical frame count.
- Identical fps.
- Identical duration.
- Identical audio stream structure.
- Decoded audio checksum match where repeatable.
- No sampler/config changes.
- No CUDA/runtime errors.
- No material performance regression.
- No obvious visual corruption.
- No black or wrong-channel preview.
- Final video remains visually sane.
- Cancellation remains functional.

Performance warning thresholds:

- Time overhead greater than about 10%.
- VRAM overhead greater than about 1 GiB.
- Peak VRAM reaches an unsafe margin or OOM.
- Material RAM/swap increase.
- CUDA instability.

UI label: `Approximate Preview`.

This preview is not final quality and must not be presented as final output.
