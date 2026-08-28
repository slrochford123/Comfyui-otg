$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$VoiceModels = Join-Path $Root "lib\characters\voiceDesignModels.ts"
$CharactersPanel = Join-Path $Root "app\app\components\CharactersPanel.tsx"
$Workflow = Join-Path $Root "comfy_workflows\presets\LTX Voice Sample.json"
$Checklist = Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\ltx-voice-design-p1-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

foreach ($path in @($VoiceModels, $CharactersPanel, $Workflow, $Checklist)) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Copy-Item -LiteralPath $VoiceModels -Destination (Join-Path $BackupDir "voiceDesignModels.ts.bak") -Force
Copy-Item -LiteralPath $CharactersPanel -Destination (Join-Path $BackupDir "CharactersPanel.tsx.bak") -Force
Copy-Item -LiteralPath $Workflow -Destination (Join-Path $BackupDir "LTX Voice Sample.json.bak") -Force
Copy-Item -LiteralPath $Checklist -Destination (Join-Path $BackupDir "OTG_REWORK_CHECKLIST.md.bak") -Force
Pass "Backed up files to $BackupDir"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($VoiceModels, [System.IO.File]::ReadAllText($VoiceModels), $Utf8NoBom)
[System.IO.File]::WriteAllText($CharactersPanel, [System.IO.File]::ReadAllText($CharactersPanel), $Utf8NoBom)
[System.IO.File]::WriteAllText($Workflow, [System.IO.File]::ReadAllText($Workflow), $Utf8NoBom)
[System.IO.File]::WriteAllText($Checklist, [System.IO.File]::ReadAllText($Checklist), $Utf8Bom)
Pass "Rewrote patched files"

$voiceText = Get-Content -LiteralPath $VoiceModels -Raw
$panelText = Get-Content -LiteralPath $CharactersPanel -Raw
$checklistText = Get-Content -LiteralPath $Checklist -Raw
$workflowJson = Get-Content -LiteralPath $Workflow -Raw | ConvertFrom-Json

$voiceMarkers = @(
  'DEFAULT_VOICE_SAMPLE_TEXT',
  'LTX_VOICE_DIALECTS',
  'buildLtxVoiceAuditionPrompt',
  'ltxvoice',
  'standard_british_southern_england',
  'jamaican_patwa'
)
foreach ($marker in $voiceMarkers) {
  if (-not $voiceText.Contains($marker)) {
    Fail "Missing voice model marker: $marker"
  }
}

$dialectCount = ([regex]::Matches($voiceText, 'kind:\s*"ltx_dialect"')).Count
if ($dialectCount -ne 52) {
  Fail "Expected 52 LTX dialect entries, found $dialectCount"
}

$panelMarkers = @(
  'ltxvoice',
  'LTX Voice ComfyUI execution will be wired in Patch 2',
  'English fixed',
  'Accent and language pickers are hidden for these providers'
)
foreach ($marker in $panelMarkers) {
  if (-not $panelText.Contains($marker)) {
    Fail "Missing CharactersPanel marker: $marker"
  }
}

if ($workflowJson.PSObject.Properties['358'].Value.inputs.value -ne 10) { Fail "Node 358 duration is not 10" }
if ($workflowJson.PSObject.Properties['357'].Value.inputs.value -ne 1) { Fail "Node 357 frame rate is not 1" }
if ($workflowJson.PSObject.Properties['369'].Value.inputs.value -ne 1920) { Fail "Node 369 width is not 1920" }
if ($workflowJson.PSObject.Properties['356'].Value.inputs.value -ne 1080) { Fail "Node 356 height is not 1080" }
if ($workflowJson.PSObject.Properties['359'].Value.inputs.value -ne $true) { Fail "Node 359 text-to-video switch is not true" }
if ($workflowJson.PSObject.Properties['384'].Value.class_type -ne "SaveAudioMP3") { Fail "Node 384 is not SaveAudioMP3" }
if ($workflowJson.PSObject.Properties['384'].Value.inputs.quality -ne "320k") { Fail "Node 384 quality is not 320k" }
if (-not $workflowJson.PSObject.Properties['360']) { Fail "Missing prompt node 360" }
if (-not $workflowJson.PSObject.Properties['370']) { Fail "Missing negative prompt node 370" }

if (-not $checklistText.Contains("LTX Voice Design Patch 1")) {
  Fail "Missing checklist marker"
}

Pass "LTX Voice Design Patch 1 markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
