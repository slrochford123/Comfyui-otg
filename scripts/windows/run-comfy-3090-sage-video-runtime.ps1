$ErrorActionPreference = "Stop"

$ComfyRoot = "C:\AI\Comfyui"
$ComfyMain = Join-Path $ComfyRoot "ComfyUI\main.py"
$Python = Join-Path $ComfyRoot "python_embeded\python.exe"
$ComfyOutput = "E:\Renders\ComfyUI"
$ComfyPort = "8188"
$ComfyUser = "C:\AI\Comfyui\ComfyUI\user_8188_sage_video"
$ComfyDbUrl = "sqlite:///C:/AI/Comfyui/ComfyUI/user_8188_sage_video/comfyui.db"

if (Get-NetTCPConnection -LocalPort ([int]$ComfyPort) -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $ComfyPort is already listening. Refusing to start duplicate Comfy 3090 Sage Video lane."
}

if (!(Test-Path -LiteralPath $ComfyRoot)) {
  throw "Comfy root not found: $ComfyRoot"
}

if (!(Test-Path -LiteralPath $Python)) {
  throw "Comfy embedded Python not found: $Python"
}

if (!(Test-Path -LiteralPath $ComfyMain)) {
  throw "Comfy main.py not found: $ComfyMain"
}

New-Item -ItemType Directory -Force -Path $ComfyOutput | Out-Null
New-Item -ItemType Directory -Force -Path $ComfyUser | Out-Null

$env:CUDA_VISIBLE_DEVICES = "0"
$env:NUMEXPR_MAX_THREADS = "16"
$env:PYTHONIOENCODING = "utf-8"
$env:PATH = "C:\AI\Tools\sox-14.4.2;$env:PATH"

Set-Location -LiteralPath $ComfyRoot

Write-Host "Starting OTG ComfyUI 3090 Sage Video runtime lane"
Write-Host "  Port: $ComfyPort"
Write-Host "  GPU: CUDA_VISIBLE_DEVICES=0"
Write-Host "  User dir: $ComfyUser"
Write-Host "  Output: $ComfyOutput"
Write-Host "  Qwen image routing: forbidden"

& $Python -s ComfyUI\main.py `
  --windows-standalone-build `
  --fast fp16_accumulation `
  --use-sage-attention `
  --disable-xformers `
  --disable-dynamic-vram `
  --listen 0.0.0.0 `
  --port $ComfyPort `
  --user-directory $ComfyUser `
  --database-url $ComfyDbUrl `
  --output-directory $ComfyOutput

exit $LASTEXITCODE
