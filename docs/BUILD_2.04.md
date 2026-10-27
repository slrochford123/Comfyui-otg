# Build 2.04 — additive SelfLift H3 Reference-to-Video

Source candidate; activation and publication must be verified separately.

The H3 reference model chooser retains Standard and Singularity (Native 20 /
Turbo 8, legacy SLA) and FastH3 (configuration C, Euler 8 / VSA). SelfLift is a
fourth model-option entry using the same FastH3 OmniRef checkpoint and reference
conditioning, with six half-resolution evaluations, a learned H3 latent lift,
and two full-resolution evaluations. It is an experimental sampling profile,
not a separate base checkpoint or a postprocessing upscaler.

The common backend, selected-GPU scheduling/leases, authentication, exact media
binding, progress/preview, cancellation, audio, Gallery and history remain in
use. Both decoders consume SelfLift output 0. There is no silent GPU fallback.
No review checkbox, new PROD permission requirement or fabricated qualification
record was introduced. Existing TEST authorization and PROD admission policies
are unchanged. Compiler identities distinguish SelfLift from ordinary FastH3.

The initial option is **Reference-to-Video only**. T2V, I2V, Edit Video, Body Swap,
Realism and legacy special-mode mappings are unchanged. Only previously compatible
explicit FastH3 catalog LoRAs may be stacked; existing trigger/strength validation
remains applied. Singularity Realism/Combat and legacy Turbo adapters are not
automatically applied to SelfLift. RefMod/Motion remain unavailable for this
profile. Saved legacy Native/Turbo selections survive switching away and back.

## Required worker capability

Upstream node revision: `facok/comfyui-SelfLift@835c3cf7919410f71f414688f049c6ca497789d0`.
Required class: `SelfLiftH3Sampler`; required lifter:
`minimax_h3_latent_upscaler_3d_fp16.safetensors`, 690592672 bytes,
SHA256 `043e5a48e161610ef6c3ea974645220354d06fa618abca15f76d084812eb55c2`.
Both hosts' existing lifter bytes matched that checksum during preparation.
No replacement checkpoints, model downloads, pip installation or driver changes
are required. The node is currently available in the isolated research worker,
not the running shared workers. App activation alone cannot load a new worker
custom node. Missing node/lifter errors must fail on the selected GPU, never
redirect to another GPU or substitute another sampler.

The source integration does not vendor upstream node code or weights. The
reviewed upstream checkout has no root LICENSE file; no redistribution license
is inferred. Its existing private owner installation is reused outside the
application/GitHub package. No independent third-party rights document or
physical qualification is claimed. Official research source:
https://github.com/facok/comfyui-SelfLift/tree/835c3cf7919410f71f414688f049c6ca497789d0

## Validation and release boundary

Use compilation, graph/AV/preview inspection, focused H3/UI regressions, TypeScript,
Node22 native probes, production build and secret scan before packaging.
Source is based on Build2.03 `ffea70a53cdf80e4b6ef430f519122155acb2e93`.
Settings history appends Build2.04 without rewriting prior builds or tags.
No new GPU generation or paid API test is part of this integration pass.

The prior successful 5060 Ti café benchmark is evidence of that experimental
profile, not proof of every app resolution, LoRA stack or RTX3090 generation.
The owner performs those feature tests after guarded TEST activation.
Only after TEST acceptance should an immutable build-2.04 revision be published
and an exact-SHA guarded PROD package prepared. Do not activate an old Build2.03
script against a changed pointer.
