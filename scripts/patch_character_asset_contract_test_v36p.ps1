param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $RepoRoot ".patch-backups\character-asset-contract-v36p-$stamp"
$files = @(
  "lib\characters\store.ts",
  "app\api\characters\route.ts",
  "app\app\components\CharactersPanel.tsx",
  "app\app\components\ProductionCharacterReferencePickerBridge.tsx",
  "app\app\components\QwenSceneBuilderPanel.tsx",
  "app\api\comfy\route.ts",
  "lib\comfyGallerySync.ts",
  "rework-checklist-background-storyboard-v36p.txt"
)

function Backup-File([string]$rel) {
  $src = Join-Path $RepoRoot $rel
  $dst = Join-Path $backupRoot $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
}

function Read-Text([string]$rel) {
  [IO.File]::ReadAllText((Join-Path $RepoRoot $rel))
}

function Write-Text([string]$rel, [string]$text) {
  $path = Join-Path $RepoRoot $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  [IO.File]::WriteAllText($path, $text, [Text.UTF8Encoding]::new($false))
}

foreach ($file in $files) { Backup-File $file }

$store = Read-Text "lib\characters\store.ts"
if ($store -notmatch "characterCardWorkflowImagePath\?: string;") {
  $fields = @"
  characterCardWorkflowImagePath?: string;
  characterCardPreviewImagePath?: string;
  defaultCharacterImagePath?: string;
  defaultCharacterPreviewImagePath?: string;
  defaultCharacterSourceImagePath?: string;
  backgroundRemovedDefaultImagePath?: string;
  defaultCharacterImageStatus?: "background_removed" | "fallback_original_card" | "missing";
"@
  $store = $store -replace "  characterCardPath\?: string;\r?\n  description: string;", "  characterCardPath?: string;`r`n$fields`r`n  description: string;"
}
if ($store -notmatch "characterCardWorkflowImagePath: input\.characterCardWorkflowImagePath") {
  $store = $store.Replace(
    "    characterCardPath: input.characterCardPath ? String(input.characterCardPath).trim() : undefined,",
    "    characterCardPath: input.characterCardPath ? String(input.characterCardPath).trim() : undefined,`r`n    characterCardWorkflowImagePath: input.characterCardWorkflowImagePath ? String(input.characterCardWorkflowImagePath).trim() : undefined,`r`n    characterCardPreviewImagePath: input.characterCardPreviewImagePath ? String(input.characterCardPreviewImagePath).trim() : undefined,`r`n    defaultCharacterImagePath: input.defaultCharacterImagePath ? String(input.defaultCharacterImagePath).trim() : undefined,`r`n    defaultCharacterPreviewImagePath: input.defaultCharacterPreviewImagePath ? String(input.defaultCharacterPreviewImagePath).trim() : undefined,`r`n    defaultCharacterSourceImagePath: input.defaultCharacterSourceImagePath ? String(input.defaultCharacterSourceImagePath).trim() : undefined,`r`n    backgroundRemovedDefaultImagePath: input.backgroundRemovedDefaultImagePath ? String(input.backgroundRemovedDefaultImagePath).trim() : undefined,`r`n    defaultCharacterImageStatus: input.defaultCharacterImageStatus,"
  )
}
if ($store -notmatch "existing\?\.backgroundRemovedDefaultImagePath") {
  $store = $store.Replace(
    "    existing?.characterCardPath,",
    "    existing?.characterCardPath,`r`n    existing?.characterCardWorkflowImagePath,`r`n    existing?.characterCardPreviewImagePath,`r`n    existing?.defaultCharacterImagePath,`r`n    existing?.defaultCharacterPreviewImagePath,`r`n    existing?.defaultCharacterSourceImagePath,`r`n    existing?.backgroundRemovedDefaultImagePath,"
  )
}
Write-Text "lib\characters\store.ts" $store

$route = Read-Text "app\api\characters\route.ts"
if ($route -notmatch "defaultCharacterImageStatus: body\?\.defaultCharacterImageStatus") {
  $route = $route.Replace(
    "      characterCardPath: body?.characterCardPath,",
    "      characterCardPath: body?.characterCardPath,`r`n      characterCardWorkflowImagePath: body?.characterCardWorkflowImagePath,`r`n      characterCardPreviewImagePath: body?.characterCardPreviewImagePath,`r`n      defaultCharacterImagePath: body?.defaultCharacterImagePath,`r`n      defaultCharacterPreviewImagePath: body?.defaultCharacterPreviewImagePath,`r`n      defaultCharacterSourceImagePath: body?.defaultCharacterSourceImagePath,`r`n      backgroundRemovedDefaultImagePath: body?.backgroundRemovedDefaultImagePath,`r`n      defaultCharacterImageStatus: body?.defaultCharacterImageStatus,"
  )
}
Write-Text "app\api\characters\route.ts" $route

$panel = Read-Text "app\app\components\CharactersPanel.tsx"
$noGalleryFlags = @"
  body.set("saveToGallery", "false");
  body.set("save_to_gallery", "false");
  body.set("persistToGallery", "false");
  body.set("addToGallery", "false");
  body.set("copyToGallery", "false");
  body.set("gallery", "false");
  body.set("skipGallery", "true");
  body.set("skipGeneralGallery", "true");
  body.set("assetLibraryOnly", "true");
  body.set("outputLibrary", "characters");
"@
if ($panel -notmatch "character-builder-fullbody-completion-only") {
  $panel = $panel.Replace(
    "  body.set(""sourceType"", ""characters-tab-builder-upload-fullbody"");",
    "  body.set(""sourceType"", ""characters-tab-builder-upload-fullbody"");`r`n$noGalleryFlags`r`n  body.set(""galleryExclusionPolicy"", ""character-builder-fullbody-completion-only"");"
  )
}
if ($panel -notmatch "character-card-only") {
  $panel = $panel.Replace(
    "  body.set(""sourceType"", ""characters-8-angle-card"");",
    "  body.set(""sourceType"", ""characters-8-angle-card"");`r`n$noGalleryFlags`r`n  body.set(""galleryExclusionPolicy"", ""character-card-only"");"
  )
}
if ($panel -match "imagePath: characterCard\.serverPath") {
  $panel = $panel -replace "(\s*)imagePath: characterCard\.serverPath,\r?\n\s*previewImagePath: characterCard\.serverPath,\r?\n\s*fullBodyImagePath: selectedFullBody\.serverPath,\r?\n\s*characterCardPath: characterCard\.serverPath,", "`$1fullBodyImagePath: selectedFullBody.serverPath,`r`n`$1...(await characterImageContractFromCandidateV36BP5({`r`n`$1  characterName: String((details as any)?.name || ""character""),`r`n`$1  characterCard,`r`n`$1})),"
}
if ($panel -match "processedDefaultDisplayPath") {
  $panel = $panel.Replace("  const processedDefaultDisplayPath = otgDisplayImageUrlV36BP8(processedDefaultSourcePath || characterCardPath);`r`n  const hasProcessedDefault = Boolean(processedDefaultSourcePath && processedDefaultSourcePath !== characterCardPath);", "  const hasProcessedDefault = Boolean(processedDefaultSourcePath && processedDefaultSourcePath !== characterCardPath);`r`n  const defaultImagePath = processedDefaultSourcePath || characterCardPath;")
  $panel = $panel.Replace("imagePath: processedDefaultDisplayPath", "imagePath: defaultImagePath")
  $panel = $panel.Replace("previewImagePath: processedDefaultDisplayPath", "previewImagePath: defaultImagePath")
  $panel = $panel.Replace("defaultCharacterImagePath: processedDefaultDisplayPath", "defaultCharacterImagePath: defaultImagePath")
  $panel = $panel.Replace("defaultCharacterPreviewImagePath: processedDefaultDisplayPath", "defaultCharacterPreviewImagePath: defaultImagePath")
  $panel = $panel.Replace("backgroundRemovedDefaultImagePath: processedDefaultDisplayPath", "backgroundRemovedDefaultImagePath: defaultImagePath")
  $panel = $panel.Replace("defaultCharacterSourceImagePath: processedDefaultSourcePath || characterCardPath", "defaultCharacterSourceImagePath: defaultImagePath")
}
Write-Text "app\app\components\CharactersPanel.tsx" $panel

$picker = Read-Text "app\app\components\ProductionCharacterReferencePickerBridge.tsx"
if ($picker -notmatch "defaultCharacterPreviewImagePath") {
  $picker = $picker.Replace(
    "      const imagePath = String(entry?.productionReferenceImagePath || entry?.previewImagePath || entry?.imagePath || """").trim();`r`n      const workflowImagePath = String(entry?.characterCardPath || entry?.imagePath || imagePath).trim();",
    "      const imagePath = String(entry?.productionReferenceImagePath || entry?.defaultCharacterPreviewImagePath || entry?.defaultCharacterImagePath || entry?.backgroundRemovedDefaultImagePath || entry?.previewImagePath || entry?.imagePath || """").trim();`r`n      const workflowImagePath = String(entry?.characterCardWorkflowImagePath || entry?.characterCardPath || entry?.characterCardImagePath || imagePath).trim();"
  )
}
Write-Text "app\app\components\ProductionCharacterReferencePickerBridge.tsx" $picker

$qwen = Read-Text "app\app\components\QwenSceneBuilderPanel.tsx"
if ($qwen -notmatch "characterCardImagePath`"") {
  $qwen = $qwen.Replace(
    "function assetImageFromRecord(record: Record<string, unknown>) {`r`n  return firstString(record, [`r`n    ""workflowImage"",",
    "function assetImageFromRecord(record: Record<string, unknown>) {`r`n  return firstString(record, [`r`n    ""characterCardWorkflowImagePath"",`r`n    ""characterCardPath"",`r`n    ""characterCardImagePath"",`r`n    ""workflowImage"","
  )
}
Write-Text "app\app\components\QwenSceneBuilderPanel.tsx" $qwen

$comfy = Read-Text "app\api\comfy\route.ts"
if ($comfy -notmatch "characters-upload-fullbody-completion") {
  $comfy = $comfy.Replace("context.includes(""characters-tab-builder"") ||", "context.includes(""characters-tab-builder"") ||`r`n    context.includes(""characters-upload-fullbody-completion"") ||`r`n    context.includes(""characters-tab-builder-upload-fullbody"") ||`r`n    context.includes(""characters-8-angle-card"") ||`r`n    context.includes(""character-card-only"") ||")
  $comfy = $comfy.Replace("text.includes(""characters-tab-builder"") ||", "text.includes(""characters-tab-builder"") ||`r`n    text.includes(""characters-upload-fullbody-completion"") ||`r`n    text.includes(""characters-tab-builder-upload-fullbody"") ||`r`n    text.includes(""characters-8-angle-card"") ||`r`n    text.includes(""character-card-only"") ||")
}
Write-Text "app\api\comfy\route.ts" $comfy

$sync = Read-Text "lib\comfyGallerySync.ts"
if ($sync -notmatch "shouldSuppressGeneralGalleryImport") {
  $syncHelper = @'
function metaString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metaLower(value: unknown): string {
  return metaString(value).toLowerCase();
}

function shouldSuppressGeneralGalleryImport(submitPayload: unknown): boolean {
  if (!submitPayload || typeof submitPayload !== "object" || Array.isArray(submitPayload)) return false;
  const payload = submitPayload as Record<string, unknown>;
  const explicitNoGallery =
    payload.saveToGallery === false ||
    payload.save_to_gallery === false ||
    payload.persistToGallery === false ||
    payload.addToGallery === false ||
    payload.copyToGallery === false ||
    payload.writeToGallery === false ||
    payload.gallery === false ||
    payload.skipGallery === true ||
    payload.skipGeneralGallery === true ||
    payload.assetLibraryOnly === true ||
    metaLower(payload.saveToGallery) === "false" ||
    metaLower(payload.save_to_gallery) === "false" ||
    metaLower(payload.persistToGallery) === "false" ||
    metaLower(payload.addToGallery) === "false" ||
    metaLower(payload.copyToGallery) === "false" ||
    metaLower(payload.writeToGallery) === "false" ||
    metaLower(payload.gallery) === "false" ||
    metaLower(payload.skipGallery) === "true" ||
    metaLower(payload.skipGeneralGallery) === "true" ||
    metaLower(payload.assetLibraryOnly) === "true" ||
    Boolean(payload.galleryExclusionPolicy);

  const context = [
    payload.requestKind,
    payload.kind,
    payload.jobKind,
    payload.sourceType,
    payload.source,
    payload.origin,
    payload.outputLibrary,
    payload.galleryExclusionPolicy,
  ]
    .map((value) => (typeof value === "string" ? value : ""))
    .join(" ")
    .toLowerCase();

  const creationCandidateContext =
    context.includes("character-builder-image") ||
    context.includes("characters-tab-builder") ||
    context.includes("characters-upload-fullbody-completion") ||
    context.includes("characters-tab-builder-upload-fullbody") ||
    context.includes("characters-8-angle-card") ||
    context.includes("character-card-only") ||
    context.includes("character-candidate") ||
    context.includes("characters-background-studio-preview") ||
    context.includes("characters-background-studio") ||
    context.includes("background-candidate") ||
    context.includes("background-studio-preview") ||
    context.includes("background-studio");

  return explicitNoGallery || creationCandidateContext;
}

'@
  $sync = $sync.Replace("function configuredRenderImportRoots() {", $syncHelper + "function configuredRenderImportRoots() {")
}
if ($sync -notmatch "shouldSuppressGeneralGalleryImport\(syncContext\.submitPayload\)") {
  $syncGuard = @'
  if (shouldSuppressGeneralGalleryImport(syncContext.submitPayload)) {
    writeState(args.ownerKey, {
      promptId,
      fileName: state?.fileName || null,
      status: state?.status || "idle",
      lastSyncedPromptId: promptId,
    });

    return {
      ok: true,
      promptId,
      status: "synced",
      saved: [],
    };
  }

'@
  $sync = $sync.Replace("  const saved: string[] = [];", $syncGuard + "  const saved: string[] = [];")
}
Write-Text "lib\comfyGallerySync.ts" $sync

Write-Text "rework-checklist-background-storyboard-v36p.txt" @"
v36p TEST update - ComfyUI/OTG character asset contract

- Preserve saved character default/profile fields separately from character-card workflow fields.
- Characters tab and Production/Storyboard picker previews use processed default/profile images.
- Workflow/add-to-scene paths prefer characterCardWorkflowImagePath, then characterCardPath.
- Character Builder Comfy jobs mark full-body completion and 8-angle cards as no-general-gallery outputs.
- Gallery sync skips Comfy outputs whose submit payload is marked saveToGallery=false, skipGeneralGallery=true, assetLibraryOnly=true, or character/background builder-only.

Verification target:
- Run npx tsc --noEmit.
- Manually verify generated/uploaded standard and freeform saves keep processed default image for display and character card for workflow.
"@

Write-Host "Backups written to $backupRoot"
Write-Host "Patch script complete. Run: npx tsc --noEmit"
