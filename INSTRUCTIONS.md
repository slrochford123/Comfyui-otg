# OTG Ratio/Size UI - Full Fix Patch

This zip contains:
- app/components/QueuePanel.tsx (renders RatioProfilePicker section)
- app/components/RatioProfilePicker.tsx
- app/lib/videoProfiles.ts
- app/lib/build.ts (BUILD = 1.0.06)
- app/globals.css (select/option visibility)

## Required edits in your existing app/app/page.tsx

1) Import types:
   import type { VideoProfileSelection, VideoProfileConstraints } from "@/lib/videoProfiles";

2) Add state near other UI state:
   const [videoProfile, setVideoProfile] = useState<VideoProfileSelection>({ ratio: "auto" });
   const [workflowProfileById, setWorkflowProfileById] = useState<Record<string, VideoProfileConstraints | undefined>>({});

3) When loading presets from /api/workflows, store constraints:
   setWorkflowProfileById(Object.fromEntries(list.map(p => [p.id, (p as any).profile])));

4) When rendering QueuePanel, pass:
   videoProfile={videoProfile}
   setVideoProfile={setVideoProfile}
   videoProfileConstraints={workflowProfileById[selectedPreset]}

5) When building the POST payload to /api/comfy, include:
   videoProfile,

## Confirm it worked
- Build badge should show 1.0.06
- You should see a "Ratio profile" card with buttons under Prompts.
