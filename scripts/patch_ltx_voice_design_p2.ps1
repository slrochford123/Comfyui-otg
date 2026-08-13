$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Files = @(
  "lib\characterVoiceAudioStudio.ts",
  "lib\jobs\voicePipelineJobs.ts",
  "lib\jobs\workerJobContract.ts",
  "app\api\worker\jobs\claim\route.ts",
  "app\api\characters\voice-sample\upload\route.ts",
  "app\app\components\CharactersPanel.tsx",
  "scripts\windows\otg-voice-design-worker.py",
  "scripts\windows\otg-voice-ltx-worker.py",
  "scripts\windows\otg-voice-ltx-worker.ps1",
  "comfy_workflows\presets\LTX Voice Sample.json",
  "tests\vitest\contracts\voice-pipeline-jobs.test.ts",
  "docs\OTG_REWORK_CHECKLIST.md"
)
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $Root ".patch-backups\ltx-voice-design-p2-$Stamp"

function Fail($Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Pass($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

foreach ($rel in $Files) {
  $path = Join-Path $Root $rel
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
foreach ($rel in $Files) {
  $path = Join-Path $Root $rel
  $dest = Join-Path $BackupDir ($rel -replace '[\\/:*?"<>| ]+', '_')
  Copy-Item -LiteralPath $path -Destination "$dest.bak" -Force
}
Pass "Backed up files to $BackupDir"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)
foreach ($rel in $Files) {
  $path = Join-Path $Root $rel
  $encoding = if ($rel -eq "docs\OTG_REWORK_CHECKLIST.md") { $Utf8Bom } else { $Utf8NoBom }
  [System.IO.File]::WriteAllText($path, [System.IO.File]::ReadAllText($path), $encoding)
}
Pass "Rewrote patched files"

$voiceProviderText = Get-Content -LiteralPath (Join-Path $Root "lib\characterVoiceAudioStudio.ts") -Raw
$jobsText = Get-Content -LiteralPath (Join-Path $Root "lib\jobs\voicePipelineJobs.ts") -Raw
$claimText = Get-Content -LiteralPath (Join-Path $Root "app\api\worker\jobs\claim\route.ts") -Raw
$uploadText = Get-Content -LiteralPath (Join-Path $Root "app\api\characters\voice-sample\upload\route.ts") -Raw
$panelText = Get-Content -LiteralPath (Join-Path $Root "app\app\components\CharactersPanel.tsx") -Raw
$qwenWorkerText = Get-Content -LiteralPath (Join-Path $Root "scripts\windows\otg-voice-design-worker.py") -Raw
$ltxWorkerText = Get-Content -LiteralPath (Join-Path $Root "scripts\windows\otg-voice-ltx-worker.py") -Raw
$ltxLauncherText = Get-Content -LiteralPath (Join-Path $Root "scripts\windows\otg-voice-ltx-worker.ps1") -Raw
$voiceJobsTestText = Get-Content -LiteralPath (Join-Path $Root "tests\vitest\contracts\voice-pipeline-jobs.test.ts") -Raw
$checklistText = Get-Content -LiteralPath (Join-Path $Root "docs\OTG_REWORK_CHECKLIST.md") -Raw
$workflowJson = Get-Content -LiteralPath (Join-Path $Root "comfy_workflows\presets\LTX Voice Sample.json") -Raw | ConvertFrom-Json

if (-not $voiceProviderText.Contains('"qwen3" | "cosy" | "ltx"')) { Fail "VoiceGeneratorProvider does not include ltx" }
foreach ($marker in @('"qwen3", "cosy", "ltx"', 'RemoteWorkerClaimOptions', 'matchesClaimOptions')) {
  if (-not $jobsText.Contains($marker)) { Fail "Missing jobs marker: $marker" }
}
foreach ($marker in @('claimProviders', 'claimOptions', 'claimRemoteWorkerJobAcrossOwners(workerId, jobType, action, claimOptions)')) {
  if (-not $claimText.Contains($marker)) { Fail "Missing claim route marker: $marker" }
}
if (-not $uploadText.Contains('provider === "ltx" ? "sample.mp3" : "sample.wav"')) { Fail "Upload route does not preserve LTX mp3 extension" }
foreach ($marker in @('setVoiceProvider(value === "ltxvoice" ? "ltx"', 'ltxAuditionPrompt', 'ltxDialectId', 'ltxSpokenLine')) {
  if (-not $panelText.Contains($marker)) { Fail "Missing CharactersPanel marker: $marker" }
}
if (-not $qwenWorkerText.Contains('"providers": ["qwen3", "cosy"]')) { Fail "Qwen/Cosy worker does not filter providers" }
foreach ($marker in @('provider != "ltx"', 'patch_workflow', 'node(graph, "384")', 'LTX voice workflow completed but no audio output was found.', 'LTX voice audio output was empty.', 'ltx_audio_voice_sample', 'outputAudioUrl', 'sourceWorkflowPath', 'comfyPromptId')) {
  if (-not $ltxWorkerText.Contains($marker)) { Fail "Missing LTX worker marker: $marker" }
}
foreach ($marker in @('Starting OTG LTX voice worker', 'windows-voice-ltx-worker', 'OTG_LTX_COMFY_URL', 'OTG_LTX_VOICE_WORKFLOW_PATH')) {
  if (-not $ltxLauncherText.Contains($marker)) { Fail "Missing LTX launcher marker: $marker" }
}

if ($workflowJson.PSObject.Properties['358'].Value.inputs.value -ne 10) { Fail "Node 358 duration is not 10" }
if ($workflowJson.PSObject.Properties['357'].Value.inputs.value -ne 1) { Fail "Node 357 frame rate is not 1" }
if ($workflowJson.PSObject.Properties['369'].Value.inputs.value -ne 1920) { Fail "Node 369 width is not 1920" }
if ($workflowJson.PSObject.Properties['356'].Value.inputs.value -ne 1080) { Fail "Node 356 height is not 1080" }
if ($workflowJson.PSObject.Properties['359'].Value.inputs.value -ne $true) { Fail "Node 359 text-to-video switch is not true" }
if ($workflowJson.PSObject.Properties['384'].Value.class_type -ne "SaveAudioMP3") { Fail "Node 384 is not SaveAudioMP3" }
if ($workflowJson.PSObject.Properties['384'].Value.inputs.quality -ne "320k") { Fail "Node 384 quality is not 320k" }

if (-not $checklistText.Contains("LTX Voice Design Patch 2 TEST only")) { Fail "Missing Patch 2 checklist marker" }
if (-not $checklistText.Contains("LTX Voice Design Patch 3 TEST only")) { Fail "Missing Patch 3 remaining checklist marker" }
if (-not $voiceJobsTestText.Contains("Invalid provider. Expected qwen3, cosy, or ltx.")) { Fail "Provider contract test was not updated for ltx" }

Pass "LTX Voice Design Patch 2 markers verified"
Write-Host "Run validation next:" -ForegroundColor Cyan
Write-Host "  npm run lint -- --quiet"
Write-Host "  npx tsc --noEmit --pretty false"
Write-Host "  npm test"
