# H3 Edit Video / Snapshot follow-up (TEST only)

Owner reference: minimaxH3VideoToVideo_v10.json, SHA256
`80480e792dad963630b90776c151bae6f9408ea8ed40353542a8777c9f25c7d0`.

The uploaded graph uses MiniMaxH3ReferenceToVideo with a Ref2VA checkpoint,
source video frames, optional images, joint video/audio sampling and output
encoding. Its SolAttnPatch and Turbo loader are bypassed, its adapter filename
is stale, and its output audio is generated rather than the original soundtrack.
It is a reference-guided editing architecture, not structural Fun ControlNet.

The TEST Edit Video screen defaults to this reference architecture through the
existing shared Studio compiler/engine. It does not execute the raw community
graph, its embedded media filenames/URLs, bypassed upscaler or cache patches.
The separate Structural Video Edit option preserves the existing Fun ControlNet
2–10-second path.

The reference prompt, Resolution (MP), Native/Turbo and Create Video controls are
always visible directly in Edit Video, before upload as well as after trimming.
Valid selected clips attach automatically; no collapsed preparation step is
required. Selecting another clip invalidates its reviewed plan without clearing
the prompt or creative settings. A short 4.76-second selection shows the exact
five-second limitation and offers explicit 5/10-second timeline selectors or
Structural Edit, rather than hiding the controls. Create Video performs a local
plan review before the existing generation-credit consent/submission step.

Reference editing exposes:

- 0.2 MP: 608×352; 0.6 MP: 1056×608; 1 MP: 1344×768 (approximately 0.98 MP).
  Portrait swaps width/height.
- Native: 20 steps, res_multistep/simple; no Turbo adapter.
- Turbo: matching Ref2VA 8-step adapter
  `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors`,
  Euler/simple, video/audio shifts 12/3. No FL2VA substitution.
- Project H3SLAAttention enabled by default, Comfy Kitchen engine. It is not a
  blind activation or renaming of the uploaded SolAttnPatch.
- Prepared source video, optional reference images/audio, generated/original/
  muted output audio, existing review/consent, owner isolation, RTX 3090-only
  routing, Safe Cancel, job status, Gallery and download.

The existing reference engine supports selected 5- or 10-second windows.
Selections shorter than 5 seconds remain supported by the separate structural
editor, not falsely advertised for the reference engine. Original audio is
actually remuxed from the selected private source by the existing finalizer.

Snapshot adds Use First Frame / Use Last Frame. Each seeks to the relevant
boundary, waits for seek completion and the bounded decoded-frame wait, captures
a bounded JPEG and calls the existing image-input callback. First-frame and
last-frame input roles remain distinct in Studio. Existing scrubbed Use Snapshot
and authenticated Download Snapshot remain available. Timeout/error cannot insert
the previously displayed frame; closing/unmounting invalidates pending insertion.
The dialog is above the application header, scrollable and wraps mobile actions.

No paid planner calls, GPU generations, model downloads, worker changes, PROD
changes or GitHub publication are part of this follow-up. Automated graph and
mocked UI tests are not physical/video-quality qualification.
