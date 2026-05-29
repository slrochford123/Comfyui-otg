$ErrorActionPreference = "Stop"

$Root = "C:\AI\OTG-Test2"
$HyPy = "C:\AI\Hunyuan3D\python_standalone\python.exe"
$Script = Join-Path $Root "scripts\hy3d_character_shape.py"

Write-Host ""
Write-Host "HY3D character shape smoke test"
Write-Host "Root: $Root"
Write-Host "Python: $HyPy"
Write-Host "Script: $Script"

if (!(Test-Path -LiteralPath $HyPy)) {
  throw "Missing Hunyuan3D Python: $HyPy"
}

if (!(Test-Path -LiteralPath $Script)) {
  throw "Missing wrapper script: $Script"
}

# Uses the repo demo image first. After this passes, replace this with a real character image.
$InputImage = "C:\AI\Hunyuan3D\Hunyuan3D-2.1\hy3dshape\demos\demo.png"
$CharacterId = "hy3d-smoke-character"
$OutputGlb = "C:\AI\OTG-Test2\data\characters\web_characters_builder\$CharacterId\models\hy3d_preview.glb"

if (!(Test-Path -LiteralPath $InputImage)) {
  throw "Missing input image: $InputImage"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputGlb) | Out-Null

Write-Host ""
Write-Host "Input image: $InputImage"
Write-Host "Output GLB:  $OutputGlb"
Write-Host ""

& $HyPy $Script `
  --input $InputImage `
  --character-id $CharacterId `
  --output $OutputGlb

if ($LASTEXITCODE -ne 0) {
  throw "HY3D wrapper failed with exit code $LASTEXITCODE"
}

if (!(Test-Path -LiteralPath $OutputGlb)) {
  throw "Verification failed. Output GLB missing: $OutputGlb"
}

$Item = Get-Item -LiteralPath $OutputGlb
if ($Item.Length -lt 1024) {
  throw "Verification failed. Output GLB is too small: $($Item.Length) bytes"
}

Write-Host ""
Write-Host "SUCCESS: HY3D character GLB generated."
Write-Host "Output: $($Item.FullName)"
Write-Host "Bytes:  $($Item.Length)"
