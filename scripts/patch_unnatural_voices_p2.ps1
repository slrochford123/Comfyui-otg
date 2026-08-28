$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repo ".patch-backups\unnatural-voices-p2-$stamp"

$files = @(
  "app\app\components\CharactersPanel.tsx",
  "app\api\characters\voice-sample\process\route.ts",
  "app\api\characters\voice-sample\upload\route.ts",
  "lib\characterVoiceAudioStudio.ts",
  "lib\jobs\voicePipelineJobs.ts",
  "scripts\windows\otg-voice-ltx-worker.py",
  "tests\vitest\contracts\voice-pipeline-jobs.test.ts",
  "docs\OTG_REWORK_CHECKLIST.md"
)

function Read-Text($relativePath) {
  $path = Join-Path $repo $relativePath
  if (!(Test-Path -LiteralPath $path)) {
    throw "Missing required file: $relativePath"
  }
  return [System.IO.File]::ReadAllText($path)
}

function Write-Text($relativePath, $text) {
  $path = Join-Path $repo $relativePath
  [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false))
}

function Backup-File($relativePath) {
  $source = Join-Path $repo $relativePath
  $target = Join-Path $backupRoot $relativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

function Require-Marker($relativePath, $marker) {
  $text = Read-Text $relativePath
  if (!$text.Contains($marker)) {
    throw "Verification failed: $relativePath missing marker [$marker]"
  }
  Write-Host "[OK] $relativePath contains $marker"
}

Write-Host "[START] Unnatural Voices Patch 2 verification/backup script"
Write-Host "[INFO] Repo: $repo"
Write-Host "[INFO] Backup: $backupRoot"

foreach ($file in $files) {
  Backup-File $file
  $text = Read-Text $file
  Write-Text $file $text
  Write-Host "[WRITE] Backed up and rewrote $file"
}

Require-Marker "lib\characters\unnaturalVoicePresets.ts" "UNNATURAL_VOICE_PRESETS"
Require-Marker "app\app\components\CharactersPanel.tsx" "OTG_UNNATURAL_VOICES_P2"
Require-Marker "app\app\components\CharactersPanel.tsx" 'provider: "unnatural_ltx"'
Require-Marker "app\app\components\CharactersPanel.tsx" 'source: "unnatural_voice_preset"'
Require-Marker "lib\characterVoiceAudioStudio.ts" '"unnatural_ltx"'
Require-Marker "lib\jobs\voicePipelineJobs.ts" '"unnatural_ltx"'
Require-Marker "app\api\characters\voice-sample\process\route.ts" "unnatural_ltx"
Require-Marker "app\api\characters\voice-sample\upload\route.ts" "unnatural_ltx"
Require-Marker "scripts\windows\otg-voice-ltx-worker.py" 'providers": ["ltx", "unnatural_ltx"]'
Require-Marker "scripts\windows\otg-voice-ltx-worker.py" "ltx_unnatural_voice_sample"
Require-Marker "scripts\windows\otg-voice-ltx-worker.py" "otg_unnatural_voice_"
Require-Marker "scripts\windows\otg-voice-ltx-worker.py" "noise_seed"
Require-Marker "scripts\windows\otg-voice-ltx-worker.py" "Unnatural voice workflow completed but no audio output was found."
Require-Marker "tests\vitest\contracts\voice-pipeline-jobs.test.ts" "unnatural_ltx"
Require-Marker "docs\OTG_REWORK_CHECKLIST.md" "Unnatural Voices Patch 2"

Write-Host "[SUCCESS] Unnatural Voices Patch 2 files backed up, rewritten, and verified."
