$ErrorActionPreference = "Stop"

$Target = "app\app\components\StoryboardPanel.tsx"
$PatchName = "saveDraft ReferenceError fix"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = ".otg_patch_backups\save-draft-referenceerror-$Timestamp"
$BackupPath = Join-Path $BackupRoot $Target

Write-Host "Applying patch: $PatchName"

if (!(Test-Path $Target)) {
  Write-Host "ERROR: Target file not found: $Target" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path (Split-Path $BackupPath) | Out-Null
Copy-Item $Target $BackupPath -Force

Write-Host "Backup written to: $BackupPath"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Content = [System.IO.File]::ReadAllText($Target)

if ($Content -match "function\s+saveDraft\s*\(") {
  Write-Host "saveDraft already exists. No insertion needed." -ForegroundColor Yellow
} else {
  $Needle = @'
  function persistProductionDraftSnapshot(snapshot: string, savedAt: string, mode: "manual" | "auto") {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, snapshot);
    setLastSavedAt(savedAt);
    setSaveState((current) => (mode === "manual" || current !== "saved" ? (mode === "manual" ? "saved" : "autosaved") : current));
    setSaveDetails(
      `${mode === "manual" ? "Saved" : "Auto-saved"} ${scenes.length} scene${scenes.length === 1 ? "" : "s"}, ${totals.images} image slot${totals.images === 1 ? "" : "s"}, page ${stages.findIndex((stage) => stage.id === activeStage) + 1} of ${stages.length}.`
    );
  }

  useEffect(() => {
'@

  $Replacement = @'
  function persistProductionDraftSnapshot(snapshot: string, savedAt: string, mode: "manual" | "auto") {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, snapshot);
    setLastSavedAt(savedAt);
    setSaveState((current) => (mode === "manual" || current !== "saved" ? (mode === "manual" ? "saved" : "autosaved") : current));
    setSaveDetails(
      `${mode === "manual" ? "Saved" : "Auto-saved"} ${scenes.length} scene${scenes.length === 1 ? "" : "s"}, ${totals.images} image slot${totals.images === 1 ? "" : "s"}, page ${stages.findIndex((stage) => stage.id === activeStage) + 1} of ${stages.length}.`
    );
  }

  function saveDraft() {
    try {
      persistProductionDraftSnapshot(manifestPreview, manifest.updatedAt, "manual");
      setNotice("Project saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed. Browser storage may be unavailable.";
      setSaveState("error");
      setSaveDetails(message);
      setNotice(message);
    }
  }

  useEffect(() => {
'@

  if (!$Content.Contains($Needle)) {
    Write-Host "ERROR: Expected insertion point not found. File may have drifted." -ForegroundColor Red
    Write-Host "Restore backup from: $BackupPath"
    exit 1
  }

  $Content = $Content.Replace($Needle, $Replacement)
  [System.IO.File]::WriteAllText($Target, $Content, $Utf8NoBom)
}

$Updated = [System.IO.File]::ReadAllText($Target)

if (!(Test-Path $Target)) {
  Write-Host "ERROR: Target file missing after patch." -ForegroundColor Red
  exit 1
}

if ($Updated -notmatch "function\s+saveDraft\s*\(") {
  Write-Host "ERROR: saveDraft function was not written." -ForegroundColor Red
  exit 1
}

if ($Updated -notmatch "onClick=\{saveDraft\}") {
  Write-Host "WARNING: saveDraft exists, but no onClick={saveDraft} reference was found." -ForegroundColor Yellow
} else {
  Write-Host "Verified: saveDraft function exists and Save Project button still references it." -ForegroundColor Green
}

Write-Host "Patch applied successfully." -ForegroundColor Green