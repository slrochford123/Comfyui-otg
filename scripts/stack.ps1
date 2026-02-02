$ErrorActionPreference = "Continue"

# ===== CONFIG =====
$ProjectRoot = "C:\Users\SLRoc\comfy-controller"
$ComfyBat    = "E:\ComfyUI_windows_portable\run_nvidia_gpu_sageattention.bat"
$TunnelCmd   = "cloudflared tunnel run comfyui-otg2"
# ==================

Set-Location $ProjectRoot

# Stop/delete existing (ignore errors)
pm2 delete comfyotg-app    2>$null | Out-Null
pm2 delete comfyotg-tunnel 2>$null | Out-Null
pm2 delete comfyui         2>$null | Out-Null

# Start Next.js app (run via cmd.exe)
pm2 start "C:\Windows\System32\cmd.exe" --name "comfyotg-app" -- /c "cd /d `"$ProjectRoot`" && npm run start"

# Start tunnel (run via cmd.exe)
pm2 start "C:\Windows\System32\cmd.exe" --name "comfyotg-tunnel" -- /c "$TunnelCmd"

# Start ComfyUI (run via cmd.exe)
if (!(Test-Path $ComfyBat)) { Write-Host "ComfyUI BAT not found: $ComfyBat"; exit 1 }
pm2 start "C:\Windows\System32\cmd.exe" --name "comfyui" -- /c "`"$ComfyBat`""

pm2 save --force
pm2 status
