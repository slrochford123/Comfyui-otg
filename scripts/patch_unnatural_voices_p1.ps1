Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupRoot = Join-Path $RepoRoot ".patch-backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot "unnatural-voices-p1-$Stamp"

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

function Assert-FileContains([string]$Path, [string]$Needle, [string]$Label) {
  if (!(Test-Path -LiteralPath $Path)) {
    Fail "$Label missing file: $Path"
  }
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -notlike "*$Needle*") {
    Fail "$Label missing marker: $Needle"
  }
  Write-Ok "$Label contains marker: $Needle"
}

function Backup-File([string]$RelativePath) {
  $source = Join-Path $RepoRoot $RelativePath
  if (!(Test-Path -LiteralPath $source)) {
    Write-Info "Skip backup; file does not exist yet: $RelativePath"
    return
  }
  $destination = Join-Path $BackupDir $RelativePath
  $destinationDir = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Ok "Backed up $RelativePath"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Info "Backup directory: $BackupDir"

$changedFiles = @(
  "lib\characters\unnaturalVoicePresets.ts",
  "lib\characters\voiceDesignModels.ts",
  "app\app\components\CharactersPanel.tsx",
  "docs\OTG_REWORK_CHECKLIST.md"
)

foreach ($file in $changedFiles) {
  Backup-File $file
}

$registryPath = Join-Path $RepoRoot "lib\characters\unnaturalVoicePresets.ts"
$registryContent = @'
import { DEFAULT_VOICE_SAMPLE_TEXT } from "@/lib/characters/voiceDesignModels";

export type UnnaturalVoiceCategory =
  | "Demonic / Infernal"
  | "Giants / Ogres / Trolls"
  | "Robots / Machines"
  | "Animals / Small Creatures"
  | "Aliens / Cosmic / Elemental"
  | "Nature / Spirits";

export type UnnaturalVoicePreset = {
  id: string;
  index: number;
  name: string;
  category: UnnaturalVoiceCategory;
  prompt: string;
  sampleLine: string;
  enabled: true;
};

export const UNNATURAL_VOICE_CATEGORIES = [
  "Demonic / Infernal",
  "Giants / Ogres / Trolls",
  "Robots / Machines",
  "Animals / Small Creatures",
  "Aliens / Cosmic / Elemental",
  "Nature / Spirits",
] as const satisfies readonly UnnaturalVoiceCategory[];

const SAMPLE_LINE = DEFAULT_VOICE_SAMPLE_TEXT;

function promptFor(name: string) {
  return `${name} unnatural character voice. Fixed LTX 2.3.1 creature voice preset for a complete audio-only voice audition. The speaker clearly says exactly: "${SAMPLE_LINE}"`;
}

function preset(index: number, name: string, category: UnnaturalVoiceCategory): UnnaturalVoicePreset {
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    index,
    name,
    category,
    prompt: promptFor(name),
    sampleLine: SAMPLE_LINE,
    enabled: true,
  };
}

// OTG_UNNATURAL_VOICES_P1: registry/UI only. Replace prompt text with uploaded final JSON/Markdown verbatim when present.
export const UNNATURAL_VOICE_PRESETS = [
  preset(1, "Abyss Demon", "Demonic / Infernal"),
  preset(2, "Ancient Devil", "Demonic / Infernal"),
  preset(3, "Demon King", "Demonic / Infernal"),
  preset(4, "Demon Queen", "Demonic / Infernal"),
  preset(5, "Ancient Cyclops", "Giants / Ogres / Trolls"),
  preset(6, "Deep Cave Troll", "Giants / Ogres / Trolls"),
  preset(7, "Frost Giant", "Giants / Ogres / Trolls"),
  preset(8, "Iron Jaw Ogre", "Giants / Ogres / Trolls"),
  preset(9, "War Ogre", "Giants / Ogres / Trolls"),
  preset(10, "Broken Service Robot", "Robots / Machines"),
  preset(11, "Friendly Toy Robot", "Robots / Machines"),
  preset(12, "Glitching Cyborg", "Robots / Machines"),
  preset(13, "Haunted Radio Voice", "Robots / Machines"),
  preset(14, "War Machine", "Robots / Machines"),
  preset(15, "Ancient Turtle Sage", "Animals / Small Creatures"),
  preset(16, "Deep-Voiced Bear", "Animals / Small Creatures"),
  preset(17, "Grumpy Toad", "Animals / Small Creatures"),
  preset(18, "High-Strung Squirrel", "Animals / Small Creatures"),
  preset(19, "Parrot Pirate Captain", "Animals / Small Creatures"),
  preset(20, "Rat King", "Animals / Small Creatures"),
  preset(21, "Talking Rat Gangster", "Animals / Small Creatures"),
  preset(22, "Tiny Mouse Hero", "Animals / Small Creatures"),
  preset(23, "Trickster Imp", "Demonic / Infernal"),
  preset(24, "Insectoid Alien", "Aliens / Cosmic / Elemental"),
  preset(25, "Planet-Eater Voice", "Aliens / Cosmic / Elemental"),
  preset(26, "Void Whisperer", "Aliens / Cosmic / Elemental"),
  preset(27, "Fire Elemental", "Aliens / Cosmic / Elemental"),
  preset(28, "Kraken", "Aliens / Cosmic / Elemental"),
  preset(29, "Storm Giant", "Giants / Ogres / Trolls"),
  preset(30, "Thunder Beast", "Giants / Ogres / Trolls"),
  preset(31, "Tree Spirit", "Nature / Spirits"),
] as const satisfies readonly UnnaturalVoicePreset[];

export function buildUnnaturalVoicePrompt(presetId: string): string {
  return UNNATURAL_VOICE_PRESETS.find((item) => item.id === presetId)?.prompt || UNNATURAL_VOICE_PRESETS[0].prompt;
}
'@

[System.IO.File]::WriteAllText($registryPath, $registryContent, [System.Text.UTF8Encoding]::new($false))
Write-Ok "Wrote lib\characters\unnaturalVoicePresets.ts"

$docsPath = Join-Path $RepoRoot "docs\OTG_REWORK_CHECKLIST.md"
$docsText = Get-Content -LiteralPath $docsPath -Raw
$patch1Line = "- [x] Unnatural Voices Patch 1 TEST only: added the 31-preset Unnatural Voices registry, separate Character Builder selection UI with category/preset selectors, fixed sample line and prompt preview, and blocked generation with the Patch 2 placeholder so no normal LTX dialect job is queued."
$patch2Line = "- [ ] Unnatural Voices Patch 2: wire selected fixed presets into the LTX voice workflow/worker with audio-only output."
$elevenLine = "- [ ] ElevenLabs Experimental: pending separate provider work; not part of Unnatural Voices Patch 1."

if ($docsText -notlike "*Unnatural Voices Patch 1 TEST only*") {
  $anchor = "- [x] Create Again now submits a fresh random ``seed`` / ``requestSeed`` into the ``create_voice_sample`` job input so each request is a new generation attempt."
  if ($docsText -like "*$anchor*") {
    $docsText = $docsText.Replace($anchor, "$anchor`r`n$patch1Line`r`n$patch2Line`r`n$elevenLine")
  } else {
    $docsText = $docsText.TrimEnd() + "`r`n$patch1Line`r`n$patch2Line`r`n$elevenLine`r`n"
  }
  [System.IO.File]::WriteAllText($docsPath, $docsText, [System.Text.UTF8Encoding]::new($false))
  Write-Ok "Updated docs\OTG_REWORK_CHECKLIST.md"
} else {
  Write-Ok "Checklist already contains Unnatural Voices Patch 1 entry"
}

$charactersPath = Join-Path $RepoRoot "app\app\components\CharactersPanel.tsx"
$modelsPath = Join-Path $RepoRoot "lib\characters\voiceDesignModels.ts"

Assert-FileContains $registryPath "UNNATURAL_VOICE_PRESETS" "registry"
Assert-FileContains $registryPath "UNNATURAL_VOICE_CATEGORIES" "registry"
Assert-FileContains $registryPath "OTG_UNNATURAL_VOICES_P1" "registry"
Assert-FileContains $registryPath "buildUnnaturalVoicePrompt" "registry"
Assert-FileContains $registryPath 'preset(31, "Tree Spirit"' "registry"

$presetCount = ([regex]::Matches((Get-Content -LiteralPath $registryPath -Raw), 'preset\(\d+,\s*"')).Count
if ($presetCount -ne 31) {
  Fail "Expected 31 Unnatural Voice presets, found $presetCount"
}
Write-Ok "Verified 31 Unnatural Voice presets"

Assert-FileContains $modelsPath '"unnaturalvoices"' "voiceDesignModels"
Assert-FileContains $modelsPath "Unnatural Voices" "voiceDesignModels"
Assert-FileContains $modelsPath 'profile.model === "unnaturalvoices"' "voiceDesignModels"
Assert-FileContains $modelsPath "accentOptionsForModel" "voiceDesignModels"

Assert-FileContains $charactersPath "UNNATURAL_VOICE_CATEGORIES" "CharactersPanel"
Assert-FileContains $charactersPath "UNNATURAL_VOICE_PRESETS" "CharactersPanel"
Assert-FileContains $charactersPath "buildUnnaturalVoicePrompt" "CharactersPanel"
Assert-FileContains $charactersPath 'voiceDesignProfile.model === "unnaturalvoices"' "CharactersPanel"
Assert-FileContains $charactersPath "Unnatural Voices generation will be wired in Patch 2." "CharactersPanel"
Assert-FileContains $charactersPath "OTG_UNNATURAL_VOICES_P1" "CharactersPanel"

Assert-FileContains $docsPath "Unnatural Voices Patch 1 TEST only" "checklist"
Assert-FileContains $docsPath "Unnatural Voices Patch 2" "checklist"

Write-Ok "Unnatural Voices Patch 1 markers verified."
Write-Host ""
Write-Host "Rollback: copy files back from $BackupDir to $RepoRoot, preserving relative paths."
