param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Require-Contains([string]$Text, [string]$Marker, [string]$Label) {
  if (-not $Text.Contains($Marker)) {
    throw "Missing marker: $Label"
  }
}

function Get-LtxDialectLabels([string]$Text) {
  return [regex]::Matches($Text, '\{ id: "[^"]+", label: "([^"]+)"[^\n]+kind: "ltx_dialect"') |
    ForEach-Object { $_.Groups[1].Value }
}

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $modelsPath = Join-Path $repo "lib\characters\voiceDesignModels.ts"
  $panelPath = Join-Path $repo "app\app\components\CharactersPanel.tsx"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"

  foreach ($path in @($modelsPath, $panelPath, $checklistPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required file not found: $path" }
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-dialect-sample-sync-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $modelsPath -Destination (Join-Path $backupDir "voiceDesignModels.ts") -Force
  Copy-Item -LiteralPath $panelPath -Destination (Join-Path $backupDir "CharactersPanel.tsx") -Force
  Copy-Item -LiteralPath $checklistPath -Destination (Join-Path $backupDir "OTG_REWORK_CHECKLIST.md") -Force
  Write-Ok "Backed up files to $backupDir"

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $models = [System.IO.File]::ReadAllText($modelsPath, [System.Text.Encoding]::UTF8)
  $models = $models -replace "`r?`n", "`n"
  $curlyApostrophe = [string][char]0x2019
  $australianSample = "G${curlyApostrophe}day, this is me character voice. Listen to me tone, accent, age, and emotion as I speak this line clearly."
  $jamaicanSample = "Wah gwaan, dis a mi character voice. Listen to mi tone, accent, age, an${curlyApostrophe} emotion as mi speak dis line clear-clear."
  $start = 'export const LTX_VOICE_DIALECTS: VoiceDesignOption[] = ['
  $end = "`n];`n`nexport function getLtxDialectSampleText"
  $startIndex = $models.IndexOf($start)
  if ($startIndex -lt 0) { throw "LTX_VOICE_DIALECTS start anchor not found" }
  $bodyStart = $startIndex + $start.Length
  $endIndex = $models.IndexOf($end, $bodyStart)
  if ($endIndex -lt 0) { throw "LTX helper end anchor not found" }
  $body = $models.Substring($bodyStart, $endIndex - $bodyStart)

  $items = foreach ($raw in ($body -split "`n")) {
    $line = $raw.TrimEnd()
    if (-not $line.Trim().StartsWith('{ id:')) { continue }
    if ($line -match 'label: "Australian English"') {
      $line = $line -replace 'instruction: "[^"]+"', "instruction: `"$australianSample`""
    }
    if ($line -match 'label: "Jamaican Patwa / Jamaican Creole"') {
      $line = $line -replace 'instruction: "[^"]+"', "instruction: `"$jamaicanSample`""
    }
    if ($line -notmatch 'label: "([^"]+)"') { throw "Dialect label missing in line: $line" }
    [pscustomobject]@{ Label = $Matches[1]; Line = $line }
  }
  if ($items.Count -ne 52) { throw "Expected 52 LTX dialects, found $($items.Count)" }
  $sortedLines = $items | Sort-Object -Property Label | ForEach-Object { $_.Line }
  $models = $models.Substring(0, $bodyStart) + "`n" + ($sortedLines -join "`n") + $models.Substring($endIndex)

  Require-Contains $models "export const DEFAULT_VOICE_SAMPLE_TEXT" "DEFAULT_VOICE_SAMPLE_TEXT"
  Require-Contains $models "export const LTX_VOICE_DIALECTS" "LTX_VOICE_DIALECTS"
  Require-Contains $models "export function getLtxDialectSampleText" "getLtxDialectSampleText"
  Require-Contains $models "export function isLtxDialectSampleText" "isLtxDialectSampleText"
  Require-Contains $models "export function buildLtxVoiceAuditionPrompt" "buildLtxVoiceAuditionPrompt"
  [System.IO.File]::WriteAllText($modelsPath, $models, $utf8NoBom)

  $panel = [System.IO.File]::ReadAllText($panelPath, [System.Text.Encoding]::UTF8)
  Require-Contains $panel "OTG_LTX_DIALECT_SAMPLE_SYNC" "OTG_LTX_DIALECT_SAMPLE_SYNC"
  Require-Contains $panel "const [ltxSampleTextIsCustom, setLtxSampleTextIsCustom] = useState(false);" "ltxSampleTextIsCustom state"
  Require-Contains $panel "getLtxDialectSampleText(voiceDesignProfile.accentDialectId)" "LTX dialect sample sync"
  Require-Contains $panel "setLtxSampleTextIsCustom(!isLtxDialectSampleText(String(value)))" "manual sample edit tracking"
  Require-Contains $panel "Defaults to the selected dialect's test line. You can edit it." "LTX sample helper text"
  Require-Contains $panel 'saved.voiceProvider === "qwen3" || saved.voiceProvider === "cosy" || saved.voiceProvider === "ltx"' "LTX voiceProvider draft restore"
  [System.IO.File]::WriteAllText($panelPath, $panel, $utf8NoBom)

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $checklist = $checklist -replace "`r?`n", "`r`n"
  $checklistLine = "- [x] LTX Voice Design picker UX: dialect options are alphabetized and the visible Sample phrase now syncs to the selected dialect line until manually edited."
  if (-not $checklist.Contains($checklistLine)) {
    $anchor = "- [x] LTX Voice Design Patch 1 TEST only: added the ``LTX Voice Sample.json`` workflow preset, 52 LTX dialect/stylized spoken lines, LTX Voice prompt builder/UI option, and fixed Qwen3TTS/CosyVoice Character Builder controls to English with no accent picker."
    if (-not $checklist.Contains($anchor)) { throw "Checklist anchor not found" }
    $checklist = $checklist.Replace($anchor, "$anchor`r`n$checklistLine")
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  $verifyModels = [System.IO.File]::ReadAllText($modelsPath, [System.Text.Encoding]::UTF8)
  $labels = @(Get-LtxDialectLabels $verifyModels)
  if ($labels.Count -ne 52) { throw "Expected 52 LTX dialects after write, found $($labels.Count)" }
  $sortedLabels = @($labels | Sort-Object)
  for ($i = 0; $i -lt $labels.Count; $i++) {
    if ($labels[$i] -ne $sortedLabels[$i]) {
      throw "LTX dialects are not alphabetized at index ${i}: '$($labels[$i])' should be '$($sortedLabels[$i])'"
    }
  }
  Require-Contains $verifyModels "instruction: `"$jamaicanSample`"" "Jamaican synced sample"
  Require-Contains $verifyModels "instruction: `"$australianSample`"" "Australian synced sample"

  $verifyPanel = [System.IO.File]::ReadAllText($panelPath, [System.Text.Encoding]::UTF8)
  Require-Contains $verifyPanel "OTG_LTX_DIALECT_SAMPLE_SYNC" "OTG_LTX_DIALECT_SAMPLE_SYNC verify"
  Require-Contains $verifyPanel "ltxSampleTextIsCustom" "custom flag verify"

  Write-Ok "LTX dialect ordering and sample phrase sync markers verified"
  Write-Host "Run validation next:"
  Write-Host "  npm run lint -- --quiet"
  Write-Host "  npx tsc --noEmit --pretty false"
  Write-Host "  npm test"
}
catch {
  Write-Fail $_.Exception.Message
  exit 1
}
