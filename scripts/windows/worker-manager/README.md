# Local Windows WorkerManager

This folder documents the local Windows WorkerManager configuration used by the ComfyUI-OTG TEST/dev worker lifecycle system.

The live WorkerManager remains local to this machine at:

```powershell
C:\AI\OTG-WorkerManager
```

Required local files and folders:

- `workers.json`
- `worker-manager.ps1`
- `logs\`
- `run\`
- `backups\`

Do not commit the live `logs`, `run`, or `backups` folders. They contain local runtime state.

## Install From Template

Copy the versioned templates into the local manager folder:

```powershell
New-Item -ItemType Directory -Force C:\AI\OTG-WorkerManager
Copy-Item .\scripts\windows\worker-manager\worker-manager.ps1 C:\AI\OTG-WorkerManager\worker-manager.ps1
Copy-Item .\scripts\windows\worker-manager\workers.example.json C:\AI\OTG-WorkerManager\workers.json
```

The checked-in template is for TEST/dev and defaults app worker `BaseUrl` values to:

```text
http://127.0.0.1:3001
```

Before running workers, review `workers.json` for local paths, ports, worker IDs, and dry-run flags. PROD use requires a deliberate copied config with explicitly reviewed PROD URLs; do not run the TEST template against PROD by accident.

## Verified Workers

- `voice-ltx`
- `qwen3-tts`
- `voice-design`
- `voice-dataset`
- `applio`
- `xtts`
- `whisper`
- `speaker-diarization`
- `bg-remove`
- `character-preview`
- `ace-step`
- `comfy-3090-sage-video`

## Dry-Run Only Workers

None.

## Disabled / Needs Wrapper

- `cozyvoice`

The current CozyVoice launcher is a one-shot runner, not a long-running service wrapper. Keep it disabled until a WorkerManager-owned service or job wrapper is defined and verified.

The XTTS, Whisper, speaker-diarization, BG Remove, Character Preview, ACE-Step, and Comfy 3090 Sage Video launchers are now treated as real WorkerManager-owned services/workers when the agent is launched with `-AllowRealActions`/`--allow-real-actions` and the manager config is present locally. BG Remove uses `services\bg_remove\run_bg_remove_runtime.ps1`, which skips install/setup work and only starts the existing runtime. ACE-Step uses `scripts\windows\run-ace-step-api-runtime.ps1`, which starts the API runtime on `127.0.0.1:8001` without startup install, update, or sync behavior, and reserves both `gpu:windows-3090` and `service:ace-step`. Comfy 3090 Sage Video uses `scripts\windows\run-comfy-3090-sage-video-runtime.ps1`, reserves the Windows 3090 GPU/video lane resources, and refuses duplicate startup if port `8188` is already listening.

`comfy-3090-sage-video` is a `dangerousStop` video/GPU lane for LTX/video only and must not be used for Qwen image jobs. `cozyvoice` remains disabled until it has a service or job wrapper instead of the current one-shot runner.

## Planned Coverage

WorkerManager should eventually own every optional helper that the app depends on:

- voice services: `qwen3-tts`, `xtts`, `cozyvoice`
- voice workers: `voice-design`, `voice-dataset`, `applio`, `voice-ltx`, `character-preview`
- audio helpers: `whisper`, `speaker-diarization`, `ace-step`
- image helpers: `bg-remove`
- video lane: `comfy-3090-sage-video`

## Safety Rules

- Do not put token values in `workers.json`.
- `OTG_WORKER_TOKEN` comes from the local environment only.
- Do not pass `--worker-token` on a command line.
- WorkerManager stops only PID trees it owns through its PID metadata.
- `comfy-3090-sage-video` is for video/LTX work only.
- Qwen image jobs must not route to the Windows RTX 3090 lane.

## Status Colors

- Green = ready, idle, or complete.
- Yellow = starting, running, or busy.
- Red = error, failed, or required service stopped unexpectedly.
- White = unavailable, disabled, unknown, or not configured.

## Lane Indicators

- Images = Linux RTX 5060 Ti image lane.
- Video = Windows RTX 3090 video/LTX lane.
- Audio = local Windows helper/service lane unless a service is explicitly moved.

The Windows RTX 3090 is reserved for video/LTX and related heavy preview work. The Linux RTX 5060 Ti is the image lane. Qwen image jobs must not route to the Windows RTX 3090 lane.

## Basic Commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 status all -json
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 start qwen3-tts
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 stop qwen3-tts
```

## Restore Note

`workers.example.json` and `worker-manager.ps1` are sanitized recovery templates. Copy them to `C:\AI\OTG-WorkerManager` only after reviewing the target machine and environment.

