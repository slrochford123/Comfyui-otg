# PROD Linux ComfyUI Dependencies

## Character Card Background/Angle Workflows

Active PROD Character Card angle/background workflows use the `AILab_ImageStitch` node. Linux ComfyUI must keep this custom node installed and available:

```text
/opt/ComfyUI/custom_nodes/ComfyUI-RMBG
```

Do not remove or quarantine `ComfyUI-RMBG` while Character Card, background angle plates, or BiRefNet background-removal flows depend on `AILab_ImageStitch`.

## Angles Create Image / Qwen Multiangle

Active PROD Angles Create Image uses the `QwenMultiangleCameraNode` node, shown in ComfyUI as Qwen Multiangle Camera. Linux ComfyUI must keep this custom node installed and available:

```text
/opt/ComfyUI/custom_nodes/ComfyUI-qwenmultiangle
```

Do not remove or quarantine `ComfyUI-qwenmultiangle` while `/api/angles/create-image` depends on `QwenMultiangleCameraNode`.
