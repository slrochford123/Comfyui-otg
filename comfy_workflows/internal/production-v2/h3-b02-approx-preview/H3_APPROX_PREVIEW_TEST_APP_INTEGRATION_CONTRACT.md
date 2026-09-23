# FastH3 B02 Approximate Preview TEST App Integration Contract

Scope: TEST app integration prep only. Do not use this document as PROD
activation approval.

UI label: `Approximate Preview`

Preview is not final quality. The final saved video remains the authoritative
result.

## Request Fields

Common:

- `mode`: `t2v` | `i2v` | `r2v`
- `duration`: `5` | `10`
- `quality`: `06mp` | `1mp`
- `preview_enabled`: boolean
- `prompt`: string
- `seed`: integer, default `424242`
- `negative_prompt`: not currently supported by the installed B02 graph

I2V:

- `image`: upload or ComfyUI input image path for first-frame conditioning

R2V:

- `reference_image`: upload or ComfyUI input image path for raw reference conditioning

## Workflow Selection

Workflow path is selected deterministically from:

`mode + duration + quality + preview_enabled`

| Mode | Duration | Quality | Preview off | Preview on |
| --- | ---: | --- | --- | --- |
| t2v | 5 | 06mp | `FastH3_B02_T2V_5s_06MP.json` | `FastH3_B02_T2V_5s_06MP_APPROX_PREVIEW.json` |
| t2v | 10 | 06mp | `FastH3_B02_T2V_10s_06MP.json` | `FastH3_B02_T2V_10s_06MP_APPROX_PREVIEW.json` |
| t2v | 5 | 1mp | `FastH3_B02_T2V_5s_1MP.json` | `FastH3_B02_T2V_5s_1MP_APPROX_PREVIEW.json` |
| t2v | 10 | 1mp | `FastH3_B02_T2V_10s_1MP.json` | `FastH3_B02_T2V_10s_1MP_APPROX_PREVIEW.json` |
| i2v | 5 | 06mp | `FastH3_B02_I2V_5s_06MP.json` | `FastH3_B02_I2V_5s_06MP_APPROX_PREVIEW.json` |
| i2v | 10 | 06mp | `FastH3_B02_I2V_10s_06MP.json` | `FastH3_B02_I2V_10s_06MP_APPROX_PREVIEW.json` |
| i2v | 5 | 1mp | `FastH3_B02_I2V_5s_1MP.json` | `FastH3_B02_I2V_5s_1MP_APPROX_PREVIEW.json` |
| i2v | 10 | 1mp | `FastH3_B02_I2V_10s_1MP.json` | `FastH3_B02_I2V_10s_1MP_APPROX_PREVIEW.json` |
| r2v | 5 | 06mp | `FastH3_B02_R2V_5s_06MP.json` | `FastH3_B02_R2V_5s_06MP_APPROX_PREVIEW.json` |
| r2v | 10 | 06mp | `FastH3_B02_R2V_10s_06MP.json` | `FastH3_B02_R2V_10s_06MP_APPROX_PREVIEW.json` |
| r2v | 5 | 1mp | `FastH3_B02_R2V_5s_1MP.json` | `FastH3_B02_R2V_5s_1MP_APPROX_PREVIEW.json` |
| r2v | 10 | 1mp | `FastH3_B02_R2V_10s_1MP.json` | `FastH3_B02_R2V_10s_1MP_APPROX_PREVIEW.json` |

All paths are under:

`/home/shawn-rochford/AI/ComfyUI/tests/h3_b02_workflows/`

The machine-readable source of truth is:

`fastH3B02WorkflowManifest.json`

Use each entry's `workflow_path` when preview is disabled and
`preview.preview_workflow_path` when preview is enabled.

## Preview Runtime

Preview implementation:

- Node: `ModelPreviewOverrideKJ`
- Decoder: `taeh3.safetensors`
- Latent channels: `24`
- Upscale ratio: `16`
- Preview frames per update: `8`
- Preview fps: `8`
- Max preview side: `512`

The app should label preview frames/clips as `Approximate Preview`.

## Expected Lifecycle

Normal completion:

`Queued -> Generating -> Approximate Preview available -> Generating with preview updates -> Finalizing -> Complete`

Preview events may start with a still frame and then continue as short preview
video clips. The final saved video replaces the approximate preview when
complete.

Cancellation:

`Queued/Generating -> Canceling -> Canceled`

Use ComfyUI `/interrupt` for cancellation.

ComfyUI reports an interrupted job as:

- `status_str = "error"`
- `completed = false`
- history message includes `execution_interrupted`

Map that state to app-level:

`Canceled`

Do not display it as `Failed`.

## Validation Policy

Do not require exact decoded-video frame checksum equality for FastH3 on this
installed CUDA stack. Repeated canonical no-preview runs are not bitwise video
deterministic. Audio decoded samples have been repeatable in validation runs.

Hard safety checks remain:

- generation settings unchanged except preview insertion
- output resolution/frame count/fps/duration unchanged
- audio structure unchanged
- no CUDA/runtime errors
- no black or wrong-channel preview
- final video visually sane
- cancellation skips final decode/CreateVideo/SaveVideo
