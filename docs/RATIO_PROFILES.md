# Ratio + Size Profiles (OTG)

This patch adds a unified "video profile" system:

- Ratios:
  - landscape (16:9)
  - portrait (9:16)
  - square (1:1)
  - cinematic (2.39:1)
  - ultra (up to 1536×864)
  - auto (chooses based on prompt keywords)

- Sizes:
  - small
  - medium
  - large (720p equivalent)

## Backend injection (WAN node 236)

The server injects width/height into the WAN latent node:
- default nodeId: **236** (EmptyHunyuanLatentVideo)
- can be overridden per-workflow using `__otg.latentNodeId`

Request payload (client -> /api/comfy):

```json
{
  "preset": "T2V_wan",
  "positivePrompt": "cinematic, widescreen shot ...",
  "videoProfile": { "ratio": "auto", "size": "large" }
}
```

## Per-preset constraints (comfy_workflows/index.json)

Add an optional `profile` object:

```json
{
  "id": "WAN22_T2V_5s_512_4steps",
  "file": "presets/WAN22_T2V_5s_512_4steps.json",
  "profile": {
    "allowedRatios": ["landscape", "cinematic"],
    "allowedSizes": ["small", "medium", "large"],
    "defaultRatio": "landscape",
    "defaultSize": "medium",
    "lockRatio": "landscape"
  }
}
```

- `lockRatio` forces a specific ratio (e.g., landscape-only preset).
- If constraints are omitted, all ratios/sizes are available.

## Mobile-safe defaults

If size is not set:
- mobile user-agent -> **medium**
- desktop -> **large**

Users can still explicitly choose Large on mobile.
