# WAN LoRA validation fix

## Symptom
ComfyUI rejects the prompt with:
`lora_name: '__otg_user_high__' not in list`

## Root cause
`lora_name` is an enum of installed LoRA filenames. Placeholder values are invalid.

## Fix
- Restore WAN preset JSONs (no placeholder lora_name).
- Stack user LoRAs at submit-time by creating new `LoraLoaderModelOnly` nodes using the *real* selected filename
  and rewiring downstream model connections.

## Apply
Unzip into repo root (overwrite presets), then:

```powershell
cd C:\AI\OTG-Test
Set-ExecutionPolicy -Scope Process Bypass
.\FIX_wan_lora_stack.ps1 -RepoRoot .
```

## Rebuild
```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
npm run start -- -p 3001
```
