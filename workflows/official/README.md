# Local H3 and Fibo still-image graphs (TEST)

These API-format snapshots are derived from native Comfy-Org templates, not
paid partner/API nodes. Runtime graph construction is in
`lib/images/nativeImageModels.ts`; its tests enforce checkpoint and sampler
contracts. The application replaces prompt, source image, seed and canvas.
The edit snapshot's `source.png` is a required placeholder, not an asset.

Sources reviewed October 29, 2026 (US Eastern):

- https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_minimax_h3_t2i.json
- https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_fibo2_edit_dev_pe.json
- https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_fibo2_edit_turbo_pe.json
- https://huggingface.co/Comfy-Org/MiniMax-H3
- https://huggingface.co/Comfy-Org/Fibo-2.0
- https://huggingface.co/briaai/Fibo-2.0-dev
- https://huggingface.co/briaai/Fibo-2.0-edit-turbo

H3 uses the official native still branch, 30 steps, res_multistep/simple,
BasicGuider, Comfy Kitchen attention and the video VAE in its still-image
path. This does not change any H3 video workflow or apply a Turbo LoRA.

Fibo Dev supports creation and editing: 50 Euler/simple steps, CFG 5. Turbo
is specifically an editing checkpoint: 4 Euler/simple steps, CFG 1. Its
source image and VAE are connected to TextEncodeFibo2 reference conditioning.
The optional 8B prompt enhancer is deliberately omitted: native plain-text
instructions are passed directly, with no paid LLM or extra model loading.
No legacy H3 or Qwen LoRA is silently added.

Both Fibo INT8 files come from Comfy-Org/Fibo-2.0 revision
`4742d4bec410034142c8e65559e5f00c6f29eccb`. Fibo weights are CC-BY-NC-4.0,
copyright BRIA AI, and intended here for the owner's private non-commercial
research. Commercial deployment needs a separate agreement with BRIA.
H3 retains the MiniMax H3 Community License Agreement. No licensing clearance
for a public commercial deployment is implied.

New Fibo weights are additive namespaced links (`SLR-TEST-FIBO`), not
replacements for existing files. Runtime model inventories and real target
GPU inference must be checked separately from these source snapshots.
