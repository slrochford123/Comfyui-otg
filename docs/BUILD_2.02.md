# SLR Studios Build 2.02 — selected OmniRef reference generation

Build 2.02 continues Build 2.01. Package semver remains 2.0.1; owner-facing build history is append-only. No existing immutable tag is moved.

## Runtime change

Standard H3 Reference-to-Video now compiles the owner-selected C profile through the existing shared generation engine. This covers Auto, Manual, the direct H3 API, Production and Story Creator's shared Production path. Media ownership, reference ordering, continuation frame-0 anchors, queues, GPU selection, Safe Cancel, history and Gallery remain in the existing paths.

- Checkpoint: `fasth3_omniref_8step_pruned_int8_convrot.safetensors`.
- SHA256: `851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80`; bytes: 22,213,723,064.
- Official model repository: [FastVideo/FastH3-Omni-Comfy](https://huggingface.co/FastVideo/FastH3-Omni-Comfy), pinned revision `82eff2a6eee6c962846879f4bab52610a4df24d3`.
- Eight Euler/simple steps; guidance 1 via BasicGuider; video/audio shifts 12/3.
- Comfy Kitchen backend plus trained VSA sparse pattern, 10% keep, exact conditioning sinks. The registered 12,288-token threshold is retained; smaller token sequences may correctly execute dense attention. A VSA node alone is not evidence that a particular render used sparse attention.
- Native 1 MP reference canvas: 1344 x 768, or portrait 768 x 1344. Existing 0.2/0.6 MP options remain direct output, not hidden upscales.
- RTX 3090 encoder: `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`.
- RTX 5060 Ti encoder: `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`. This is a disclosed hardware adaptation, not bit-identical conditioning across GPUs.
- No old acceleration LoRA or automatic Singularity/Realism/Combat weights are silently combined with this checkpoint. Explicit optional style selections remain explicit and require their existing compatibility/integrity checks.

The legacy template files remain reusable binding scaffolding and a separate reference-editor architecture. The final graph—not an old template filename—is the executable identity. The new compiler version and exact graph/dependency fingerprints prevent old qualifications from qualifying the new profile.

## Auto and live preview

Auto's ordinary Create Video action remains one click. Model/profile/sampler consistency is enforced server-side, not only in the UI. Reference generation uses OmniRef/VSA; Text and First/Last Frame retain their existing family-matched eight-step implementations.

Both sampling model consumers pass through ModelPreviewOverrideKJ with `taeh3.safetensors` and eight animated preview frames. The shared progress bridge retains supported animated-image/video MIME types. Preview events must reach the job's client/worker association and remain owner-scoped. A terminal preview alone does not prove live sampling preview; end-to-end generation evidence is recorded separately.

## Deliberately separate tools

Structural Fun ControlNet Edit Video, reference-guided video editing, specialized Realism, Body Swap and Ref Mods are not silently redesigned by this standard reference-generation patch. Their specialized source/conditioning behavior remains available. Any requested checkpoint migration of those tools needs its own compatible graph changes, not relabeling.

## Release safety

- No TEST credentials, permission files, physical-qualification records, databases, generated media or weights belong in Git or the PROD package.
- TEST-only installation receipts may add measured file hashes, never fabricated successful executions.
- Guarded activation must wait for queues/application jobs, preserve environment/data links and the old release, verify Node 22.23.4 effective ExecStart/PID binary/CWD and HTTP gates, and roll back only application pointer/service on failure.
- Publish/promote only the validated exact source revision. OS-admin activation is a separate operational gate; a built package is not a live deployment.
