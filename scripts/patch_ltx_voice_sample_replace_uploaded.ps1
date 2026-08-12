param(
  [string]$RepoRoot = "C:\AI\OTG-Test2",
  [string]$SourceWorkflow = "C:\Users\SLRoc\Downloads\ComfyUI_00021_.json"
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Get-Node($Graph, [string]$NodeId) {
  $node = $Graph.PSObject.Properties[$NodeId]
  if ($null -eq $node) {
    throw "Missing node $NodeId"
  }
  return $node.Value
}

function Require-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "$Label expected '$Expected' but got '$Actual'"
  }
}

function Verify-LtxWorkflow([string]$Path) {
  $text = Get-Content -LiteralPath $Path -Raw
  $graph = $text | ConvertFrom-Json

  $node336 = Get-Node $graph "336"
  $node354 = Get-Node $graph "354"
  $node366 = Get-Node $graph "366"
  $node384 = Get-Node $graph "384"

  Require-Equal $node336.class_type "LTXVAudioVAELoader" "Node 336 class_type"
  Require-Equal $node354.class_type "LTXVAudioVAEDecode" "Node 354 class_type"
  Require-Equal $node366.class_type "LTXVSeparateAVLatent" "Node 366 class_type"
  Require-Equal $node384.class_type "SaveAudioMP3" "Node 384 class_type"

  Require-Equal $node354.inputs.samples[0] "366" "Node 354 samples source node"
  Require-Equal $node354.inputs.samples[1] 1 "Node 354 samples source output"
  Require-Equal $node354.inputs.audio_vae[0] "336" "Node 354 audio_vae source node"
  Require-Equal $node354.inputs.audio_vae[1] 0 "Node 354 audio_vae source output"
  Require-Equal $node384.inputs.audio[0] "354" "Node 384 audio source node"
  Require-Equal $node384.inputs.audio[1] 0 "Node 384 audio source output"

  Require-Equal (Get-Node $graph "369").inputs.value 1920 "Node 369 width"
  Require-Equal (Get-Node $graph "356").inputs.value 1080 "Node 356 height"
  Require-Equal (Get-Node $graph "357").inputs.value 1 "Node 357 frame rate"
  Require-Equal (Get-Node $graph "358").inputs.value 10 "Node 358 duration"
  Require-Equal (Get-Node $graph "359").inputs.value $true "Node 359 text-to-video"
  Require-Equal $node384.inputs.quality "320k" "Node 384 quality"

  $promptText = (Get-Node $graph "360").inputs.text
  if ([string]::IsNullOrWhiteSpace([string]$promptText)) {
    throw "Node 360 prompt text is missing"
  }

  if ($text.Contains('"385"')) {
    throw 'Unexpected "385" reference remains in LTX Voice Sample.json'
  }
}

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $source = (Resolve-Path -LiteralPath $SourceWorkflow).Path
  $workflowPath = Join-Path $repo "comfy_workflows\presets\LTX Voice Sample.json"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"

  if (-not (Test-Path -LiteralPath $workflowPath)) { throw "Workflow preset not found: $workflowPath" }
  if (-not (Test-Path -LiteralPath $checklistPath)) { throw "Checklist not found: $checklistPath" }

  Verify-LtxWorkflow $source
  Write-Ok "Source uploaded workflow verified: $source"

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-voice-uploaded-workflow-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workflowPath -Destination (Join-Path $backupDir "LTX Voice Sample.json") -Force
  Copy-Item -LiteralPath $checklistPath -Destination (Join-Path $backupDir "OTG_REWORK_CHECKLIST.md") -Force
  Write-Ok "Backed up files to $backupDir"

  Copy-Item -LiteralPath $source -Destination $workflowPath -Force

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $checklist = $checklist -replace "`r?`n", "`r`n"
  $checklistLine = "- [x] LTX Voice Sample workflow replaced with corrected uploaded ``ComfyUI_00021_.json``; audio chain now decodes node 366 through node 354 and saves MP3 through node 384."
  if (-not $checklist.Contains($checklistLine)) {
    $anchor = "- [x] LTX Voice workflow audio decode chain repaired: node 354 now receives samples from node 366 and audio VAE from node 336."
    if (-not $checklist.Contains($anchor)) {
      throw "Checklist anchor not found"
    }
    $checklist = $checklist.Replace($anchor, "$anchor`r`n$checklistLine")
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  Verify-LtxWorkflow $workflowPath

  $checklistVerify = Get-Content -LiteralPath $checklistPath -Raw
  if (-not $checklistVerify.Contains($checklistLine)) {
    throw "Checklist uploaded workflow entry missing"
  }

  Write-Ok "Replaced TEST LTX Voice Sample preset with uploaded ComfyUI_00021_.json"
  Write-Ok "Verified nodes 336/354/366/384, audio chain, defaults, prompt node, and no 385 reference"
}
catch {
  Write-Fail $_.Exception.Message
  exit 1
}
