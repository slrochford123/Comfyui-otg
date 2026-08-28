Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackupRoot = Join-Path $RepoRoot ".patch-backups"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot "unnatural-voices-exact-prompts-$Stamp"

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

function Backup-File([string]$RelativePath) {
  $source = Join-Path $RepoRoot $RelativePath
  if (!(Test-Path -LiteralPath $source)) {
    Fail "Cannot back up missing file: $RelativePath"
  }
  $destination = Join-Path $BackupDir $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  Write-Ok "Backed up $RelativePath"
}

function Assert-Contains([string]$Path, [string]$Needle, [string]$Label) {
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -notlike "*$Needle*") {
    Fail "$Label missing expected text: $Needle"
  }
  Write-Ok "$Label contains expected text: $Needle"
}

$sourceCandidates = @(
  (Join-Path $RepoRoot "tmp\ltx_31_final_unnatural_voice_prompts.json"),
  (Join-Path $RepoRoot "ltx_31_final_unnatural_voice_prompts.json")
)

$sourceJson = $sourceCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$sourceJson) {
  Fail "Source file not found. Expected tmp\ltx_31_final_unnatural_voice_prompts.json or ltx_31_final_unnatural_voice_prompts.json"
}
Write-Ok "Source file exists: $sourceJson"

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Info "Backup directory: $BackupDir"
Backup-File "lib\characters\unnaturalVoicePresets.ts"
Backup-File "docs\OTG_REWORK_CHECKLIST.md"

$nodeScript = @'
const fs = require("fs");
const path = require("path");

const repoRoot = process.env.OTG_REPO_ROOT;
const sourceJson = process.env.OTG_UNNATURAL_SOURCE_JSON;
const registryPath = path.join(repoRoot, "lib", "characters", "unnaturalVoicePresets.ts");
const presets = JSON.parse(fs.readFileSync(sourceJson, "utf8"));
const sampleLine = "Hello, this is my character voice. Listen to my tone, accent, age, and emotion as I speak this line clearly.";

const expectedNames = [
  "Abyss Demon",
  "Ancient Devil",
  "Demon King",
  "Demon Queen",
  "Ancient Cyclops",
  "Deep Cave Troll",
  "Frost Giant",
  "Iron Jaw Ogre",
  "War Ogre",
  "Broken Service Robot",
  "Friendly Toy Robot",
  "Glitching Cyborg",
  "Haunted Radio Voice",
  "War Machine",
  "Ancient Turtle Sage",
  "Deep-Voiced Bear",
  "Grumpy Toad",
  "High-Strung Squirrel",
  "Parrot Pirate Captain",
  "Rat King",
  "Talking Rat Gangster",
  "Tiny Mouse Hero",
  "Trickster Imp",
  "Insectoid Alien",
  "Planet-Eater Voice",
  "Void Whisperer",
  "Fire Elemental",
  "Kraken",
  "Storm Giant",
  "Thunder Beast",
  "Tree Spirit",
];

const categories = new Map([
  ["Abyss Demon", "Demonic / Infernal"],
  ["Ancient Devil", "Demonic / Infernal"],
  ["Demon King", "Demonic / Infernal"],
  ["Demon Queen", "Demonic / Infernal"],
  ["Trickster Imp", "Demonic / Infernal"],
  ["Ancient Cyclops", "Giants / Ogres / Trolls"],
  ["Deep Cave Troll", "Giants / Ogres / Trolls"],
  ["Frost Giant", "Giants / Ogres / Trolls"],
  ["Iron Jaw Ogre", "Giants / Ogres / Trolls"],
  ["War Ogre", "Giants / Ogres / Trolls"],
  ["Storm Giant", "Giants / Ogres / Trolls"],
  ["Thunder Beast", "Giants / Ogres / Trolls"],
  ["Broken Service Robot", "Robots / Machines"],
  ["Friendly Toy Robot", "Robots / Machines"],
  ["Glitching Cyborg", "Robots / Machines"],
  ["Haunted Radio Voice", "Robots / Machines"],
  ["War Machine", "Robots / Machines"],
  ["Ancient Turtle Sage", "Animals / Small Creatures"],
  ["Deep-Voiced Bear", "Animals / Small Creatures"],
  ["Grumpy Toad", "Animals / Small Creatures"],
  ["High-Strung Squirrel", "Animals / Small Creatures"],
  ["Parrot Pirate Captain", "Animals / Small Creatures"],
  ["Rat King", "Animals / Small Creatures"],
  ["Talking Rat Gangster", "Animals / Small Creatures"],
  ["Tiny Mouse Hero", "Animals / Small Creatures"],
  ["Insectoid Alien", "Aliens / Cosmic / Elemental"],
  ["Planet-Eater Voice", "Aliens / Cosmic / Elemental"],
  ["Void Whisperer", "Aliens / Cosmic / Elemental"],
  ["Fire Elemental", "Aliens / Cosmic / Elemental"],
  ["Kraken", "Aliens / Cosmic / Elemental"],
  ["Tree Spirit", "Nature / Spirits"],
]);

function idFor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

if (!Array.isArray(presets) || presets.length !== 31) {
  throw new Error(`Expected 31 source presets, found ${Array.isArray(presets) ? presets.length : "non-array"}`);
}

for (let index = 0; index < expectedNames.length; index += 1) {
  const preset = presets[index];
  if (!preset || preset.index !== index + 1 || preset.name !== expectedNames[index] || typeof preset.prompt !== "string") {
    throw new Error(`Unexpected source preset at index ${index + 1}`);
  }
  if (!preset.prompt.includes(sampleLine)) {
    throw new Error(`Source prompt missing fixed sample line: ${preset.name}`);
  }
}

const entries = presets.map((preset) => [
  "  {",
  `    id: ${JSON.stringify(idFor(preset.name))},`,
  `    index: ${preset.index},`,
  `    name: ${JSON.stringify(preset.name)},`,
  `    category: ${JSON.stringify(categories.get(preset.name))},`,
  `    prompt: ${JSON.stringify(preset.prompt)},`,
  "    sampleLine: SAMPLE_LINE,",
  "    enabled: true,",
  "  },",
].join("\n")).join("\n");

const content = `import { DEFAULT_VOICE_SAMPLE_TEXT } from "@/lib/characters/voiceDesignModels";

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

// OTG_UNNATURAL_VOICES_P1: registry/UI only. Prompts are generated from the final uploaded LTX 2.3.1 JSON source.
export const UNNATURAL_VOICE_PRESETS = [
${entries}
] as const satisfies readonly UnnaturalVoicePreset[];

export function buildUnnaturalVoicePrompt(presetId: string): string {
  return UNNATURAL_VOICE_PRESETS.find((item) => item.id === presetId)?.prompt || UNNATURAL_VOICE_PRESETS[0].prompt;
}
`;

fs.writeFileSync(registryPath, content, "utf8");
'@

$env:OTG_REPO_ROOT = $RepoRoot
$env:OTG_UNNATURAL_SOURCE_JSON = $sourceJson
try {
  $nodeScript | node -
} finally {
  Remove-Item Env:\OTG_REPO_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:\OTG_UNNATURAL_SOURCE_JSON -ErrorAction SilentlyContinue
}
Write-Ok "Wrote lib\characters\unnaturalVoicePresets.ts from source JSON"

$docsPath = Join-Path $RepoRoot "docs\OTG_REWORK_CHECKLIST.md"
$docsText = Get-Content -LiteralPath $docsPath -Raw
$repairLine = "- [x] Unnatural Voices Patch 1 registry source repaired: placeholder prompt text was replaced with exact final uploaded LTX 2.3.1 prompts from ``ltx_31_final_unnatural_voice_prompts.json``."
if ($docsText -notlike "*Unnatural Voices Patch 1 registry source repaired*") {
  $anchor = "- [x] Unnatural Voices Patch 1 TEST only: added the 31-preset Unnatural Voices registry, separate Character Builder selection UI with category/preset selectors, fixed sample line and prompt preview, and blocked generation with the Patch 2 placeholder so no normal LTX dialect job is queued."
  if ($docsText -like "*$anchor*") {
    $docsText = $docsText.Replace($anchor, "$anchor`r`n$repairLine")
  } else {
    $docsText = $docsText.TrimEnd() + "`r`n$repairLine`r`n"
  }
  [System.IO.File]::WriteAllText($docsPath, $docsText, [System.Text.UTF8Encoding]::new($false))
  Write-Ok "Updated docs\OTG_REWORK_CHECKLIST.md"
} else {
  Write-Ok "Checklist already contains exact prompt repair entry"
}

$registryPath = Join-Path $RepoRoot "lib\characters\unnaturalVoicePresets.ts"
$registryText = Get-Content -LiteralPath $registryPath -Raw
$entryCount = ([regex]::Matches($registryText, 'id: "')).Count
if ($entryCount -ne 31) {
  Fail "Expected 31 registry presets, found $entryCount"
}
Write-Ok "Registry contains 31 presets"

if ($registryText -like "*Fixed LTX 2.3.1 creature voice preset*" -or $registryText -like "*function promptFor*" -or $registryText -like "*placeholder prompt*") {
  Fail "Placeholder prompt text remains in registry"
}
Write-Ok "No placeholder prompt text remains"

Assert-Contains $registryPath "UNNATURAL_VOICE_PRESETS" "registry"
Assert-Contains $registryPath "OTG_UNNATURAL_VOICES_P1" "registry"
Assert-Contains $registryPath "bottomless black abyss" "Abyss Demon prompt"
Assert-Contains $registryPath "chipped white plating" "Broken Service Robot prompt"
Assert-Contains $registryPath "bark skin, mossy hair" "Tree Spirit prompt"
Assert-Contains $docsPath "Unnatural Voices Patch 1 registry source repaired" "checklist"

Write-Ok "Unnatural Voices exact prompt repair complete."
Write-Host ""
Write-Host "Rollback: copy files back from $BackupDir to $RepoRoot, preserving relative paths."
