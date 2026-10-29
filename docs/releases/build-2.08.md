# Build 2.08 — Compact Singularity version selection

Singularity now occupies one model-control slot: open its dropdown and choose
**1.3** or **2**. Standard, FastH3 and SelfLift keep their existing buttons.
The same version choice is available in Realism, H3 Studio and Story production.

## Exact model selection

| Selection | Checkpoint | Native | Turbo | Attention |
| --- | --- | --- | --- | --- |
| Singularity 1.3 | `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors` | 20 steps, res_multistep | 8 steps, Euler, matching acceleration adapter | SLA |
| Singularity 2 | `Minimax-h3_Singularity_ref2va_v2_pruned_int8.safetensors` | 20 steps, res_multistep | 8 steps, Euler, matching acceleration adapter | SLA |

Both versions retain automatic Realism at 0.7, independent Combat and compatible
optional LoRAs. Version switching preserves the existing render and Combat choices.
Speed labels follow the unchanged owner-defined relative rating table.

Existing persisted `singularity` selections still identify v2. New explicit
`singularity-v1.3` selections survive settings normalization, JSON persistence,
request parsing, Studio planning, compilation and checkpoint-readiness probes.
Studio request identities distinguish the versions. No historical job or saved
generation is rewritten.

Standard, FastH3 and SelfLift definitions are unchanged. Studio retains its
existing Ref2VA-only Singularity restriction; this update does not claim new
workflow compatibility. Existing direct H3 and Realism mappings are preserved.

## Verification and rollout

Use focused graph and UI tests, TypeScript and production-build checks, then
read-only loader/readiness inspection on both GPUs. Do not interpret graph
compilation as a successful GPU render or a quality benchmark.

Rollout order: immutable TEST artifact, verified TEST activation and owner review,
scoped GitHub commit/tag, isolated PROD staging and guarded owner activation.
Retain the prior release for rollback and preserve all account, gallery, model,
permission and qualification configuration.
