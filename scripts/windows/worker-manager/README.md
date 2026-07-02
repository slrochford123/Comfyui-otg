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

## Verified Workers

- `voice-ltx`
- `qwen3-tts`
- `voice-design`

## Dry-Run Only Workers

- `xtts`
- `cozyvoice`
- `voice-dataset`
- `applio`
- `bg-remove`
- `comfy-3090-sage-video`

## Safety Rules

- Do not put token values in `workers.json`.
- `OTG_WORKER_TOKEN` comes from the local environment only.
- Do not pass `--worker-token` on a command line.
- WorkerManager stops only PID trees it owns through its PID metadata.
- `comfy-3090-sage-video` is for video/LTX work only.
- Qwen image jobs must not route to the Windows RTX 3090 lane.

## Basic Commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 status all -json
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 start qwen3-tts
powershell -NoProfile -ExecutionPolicy Bypass -File C:\AI\OTG-WorkerManager\worker-manager.ps1 stop qwen3-tts
```

## Restore Note

`workers.example.json` is a sanitized recovery template. Copy it to `C:\AI\OTG-WorkerManager\workers.json` only after reviewing local paths, ports, worker IDs, and dry-run flags for the target machine.
