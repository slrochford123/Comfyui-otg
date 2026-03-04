# OTG Storyboard — Ollama Prompt Conversion + ComfyUI Batch Sequential

This patch does two things:

1) **Convert** storyboard scene ideas into a strict "Next Scene X:" prompt script using **Ollama**  
2) **Batch generate sequentially** in **ComfyUI** using **Storyboard 5.json** as the standard workflow

## Uses Storyboard 5 as the standard
Workflow file included here:

- `comfy_workflows/storyboard/Storyboard 5.json`

It injects:
- **Positive** prompt into node **30** (`easy promptLine`) as `inputs.prompt`
- **Negative** prompt into node **36** as `inputs.prompt` (only if enabled for that scene)

## New API routes
- `POST /api/storyboard/format`
- `POST /api/storyboard/batch-generate`

## Required .env.local values
You already have most of this. Ensure these exist:

```
COMFY_BASE_URL=http://127.0.0.1:8288
OTG_WORKFLOWS_ROOT=C:/AI/OTG-Test/comfy_workflows   (or COMFY_WORKFLOWS_DIR)
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama2-uncensored:7b
```

Optional:
```
OLLAMA_MODEL_STORYBOARD=qwen2.5:7b
STORYBOARD_WORKFLOW_FILE=storyboard/Storyboard 5.json
STORYBOARD_SCENE_TIMEOUT_MS=600000
STORYBOARD_OLLAMA_TIMEOUT_MS=60000
```

## How to test
1. Place the workflow file in your workflows root:
   - `C:\AI\OTG-Test\comfy_workflows\storyboard\Storyboard 5.json`

2. Restart OTG:
   - `npm run build`
   - `npm run start`

3. In OTG → Storyboard:
   - Add 2–5 scenes
   - Click **Convert (Ollama)** to verify the script
   - Click **Generate (Batch Sequential)** to submit scene 1 → wait → scene 2 → wait → etc.

## Notes / limitations (intentional for first test)
- This patch validates the **prompt conversion pipeline** and the **Comfy submission**.
- It does **not** yet map your uploaded character images into the workflow's `LoadImage` nodes.
  (Next feature: copy uploads to ComfyUI input folder + set node 14/21/28/37/40 filenames.)