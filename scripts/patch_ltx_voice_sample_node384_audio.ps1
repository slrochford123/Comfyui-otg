param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
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

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $workflowPath = Join-Path $repo "comfy_workflows\presets\LTX Voice Sample.json"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"

  if (-not (Test-Path -LiteralPath $workflowPath)) { throw "Workflow preset not found: $workflowPath" }
  if (-not (Test-Path -LiteralPath $checklistPath)) { throw "Checklist not found: $checklistPath" }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-voice-node384-audio-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $workflowPath -Destination (Join-Path $backupDir "LTX Voice Sample.json") -Force
  Copy-Item -LiteralPath $checklistPath -Destination (Join-Path $backupDir "OTG_REWORK_CHECKLIST.md") -Force
  Write-Ok "Backed up files to $backupDir"

  $graph = Get-Content -LiteralPath $workflowPath -Raw | ConvertFrom-Json

  if ($null -eq $graph.PSObject.Properties["354"]) {
    $node354 = [ordered]@{
      inputs = [ordered]@{}
      class_type = "LTXVAudioVAEDecode"
      _meta = [ordered]@{
        title = "LTXV Audio VAE Decode"
      }
    }
    $graph | Add-Member -NotePropertyName "354" -NotePropertyValue $node354
  }

  $node384 = Get-Node $graph "384"
  if ($null -eq $node384.inputs) {
    throw "Node 384 is missing inputs"
  }
  $node384.inputs.audio = @("354", 0)

  $workflowJson = $graph | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($workflowPath, $workflowJson + "`r`n", [System.Text.Encoding]::ASCII)

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $checklist = $checklist -replace "`r?`n", "`r`n"
  $checklistLine = "- [x] LTX Voice workflow node 384 audio input repaired from missing node 385 to audio decode node 354."
  if (-not $checklist.Contains($checklistLine)) {
    $anchor = "- [x] TEST launcher now starts the Voice Design Worker for Qwen3/Cosy ``create_voice_sample`` jobs and the Voice LTX Worker for ``provider: ltx`` jobs after Next TEST starts."
    if (-not $checklist.Contains($anchor)) {
      throw "Checklist anchor not found"
    }
    $checklist = $checklist.Replace($anchor, "$anchor`r`n$checklistLine")
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  $verifyText = Get-Content -LiteralPath $workflowPath -Raw
  $verifyGraph = $verifyText | ConvertFrom-Json
  $verify354 = Get-Node $verifyGraph "354"
  $verify384 = Get-Node $verifyGraph "384"

  Require-Equal $verify354.class_type "LTXVAudioVAEDecode" "Node 354 class_type"
  Require-Equal $verify384.class_type "SaveAudioMP3" "Node 384 class_type"
  Require-Equal $verify384.inputs.audio[0] "354" "Node 384 audio source node"
  Require-Equal $verify384.inputs.audio[1] 0 "Node 384 audio source output"
  Require-Equal (Get-Node $verifyGraph "369").inputs.value 1920 "Node 369 width"
  Require-Equal (Get-Node $verifyGraph "356").inputs.value 1080 "Node 356 height"
  Require-Equal (Get-Node $verifyGraph "357").inputs.value 1 "Node 357 frame rate"
  Require-Equal (Get-Node $verifyGraph "358").inputs.value 10 "Node 358 duration"
  Require-Equal (Get-Node $verifyGraph "359").inputs.value $true "Node 359 text-to-video"
  Require-Equal $verify384.inputs.quality "320k" "Node 384 quality"

  if ($verifyText.Contains('"385"')) {
    throw 'Unexpected "385" reference remains in LTX Voice Sample.json'
  }

  $checklistVerify = Get-Content -LiteralPath $checklistPath -Raw
  if (-not $checklistVerify.Contains($checklistLine)) {
    throw "Checklist repair entry missing"
  }

  Write-Ok "LTX Voice Sample node 384 audio input now points to node 354"
  Write-Ok "JSON parse and workflow markers verified"
}
catch {
  Write-Fail $_.Exception.Message
  exit 1
}
