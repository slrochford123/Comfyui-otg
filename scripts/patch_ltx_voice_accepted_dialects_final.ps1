param(
  [string]$RepoRoot = "C:\AI\OTG-Test2"
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$Message) { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }
function Require-Contains([string]$Text, [string]$Marker, [string]$Label) {
  if (-not $Text.Contains($Marker)) { throw "Missing marker: $Label" }
}
function Escape-Ts([string]$Value) {
  return $Value.Replace("\", "\\").Replace('"', '\"')
}

$NegativePrompt = "singing, music, background noise, background noises, sound effects, sound effect, ambience, crowd noise, overlapping voices, multiple speakers, choir, instrumental, soundtrack, reverb, echo, muffled speech, distorted speech, whispering, mumbling"

$DialectJson = @'
[
  {"id":"african_american_vernacular","label":"African American Vernacular","promptLabel":"African American Vernacular","auditionLine":"Ayo, this voice right here got rhythm and heart. I am speaking clear, strong, and alive, with real feeling in every word.","enabled":true},
  {"id":"arabic","label":"Arabic","promptLabel":"Arabic","auditionLine":"Marhaba, my friend. This voice speaks with warmth, strength, and clear emotion, carrying rich rhythm in every word today.","enabled":true},
  {"id":"australian","label":"Australian","promptLabel":"Australian","auditionLine":"G'day, mate. This is my voice, easy and bright, speaking clear with Aussie rhythm, warm feeling, and cheeky charm.","enabled":true},
  {"id":"belizean_kriol","label":"Belizean Kriol","promptLabel":"Belizean Kriol","auditionLine":"Eh bwai, dis da mi voice. I di talk clear and strong, wid Belize rhythm, warm heart, and plenty feeling.","enabled":true},
  {"id":"british","label":"British","promptLabel":"British","auditionLine":"Hello, this is my voice. I am speaking with a composed British tone, clear rhythm, careful feeling, and confident expression.","enabled":true},
  {"id":"chicago","label":"Chicago","promptLabel":"Chicago","auditionLine":"Hey, this is my voice. I am speaking direct and clear, with Chicago energy, city rhythm, and strong honest feeling.","enabled":true},
  {"id":"essex","label":"Essex","promptLabel":"Essex","auditionLine":"Oi, listen up. This is my voice, bright and confident, speaking clear with Essex attitude, rhythm, and proper feeling.","enabled":true},
  {"id":"french","label":"French","promptLabel":"French","auditionLine":"Bonjour, my friend. This voice speaks with French elegance, soft rhythm, warm emotion, and clear feeling in every word.","enabled":true},
  {"id":"general_american","label":"General American","promptLabel":"General American","auditionLine":"Hello, this is my voice. I am speaking clearly with a natural American sound, steady tone, and controlled emotion.","enabled":true},
  {"id":"german","label":"German","promptLabel":"German","auditionLine":"Hallo, my friend. This voice is clear, steady, and precise, with strong tone, careful rhythm, and controlled emotion.","enabled":true},
  {"id":"ghanaian","label":"Ghanaian","promptLabel":"Ghanaian","auditionLine":"Ei, chale, this is my voice. I am speaking clearly with Ghanaian warmth, bright rhythm, strong energy, and real feeling.","enabled":true},
  {"id":"guyanese","label":"Guyanese","promptLabel":"Guyanese","auditionLine":"Ay bai, dis is meh voice. I talking clear and strong, wid Guyanese rhythm, warm feeling, and real character inside.","enabled":true},
  {"id":"indian","label":"Indian","promptLabel":"Indian","auditionLine":"Hello, my friend. This is my voice. Please listen carefully to the tone, emotion, rhythm, and clear expression in every word.","enabled":true},
  {"id":"italian","label":"Italian","promptLabel":"Italian","auditionLine":"Ciao, my friend. This-a voice speaks with heart, warm rhythm, open emotion, and clear feeling in every single word.","enabled":true},
  {"id":"jamaican","label":"Jamaican","promptLabel":"Jamaican","auditionLine":"Wah gwaan, mi friend. Dis ya voice bright like Kingston morning; mi talk wid heart, rhythm, and clear Jamaican feeling.","enabled":true},
  {"id":"london_cockney","label":"London Cockney","promptLabel":"London Cockney","auditionLine":"Oi, listen here. This is me voice, clear as day, with London bite, warm feeling, and proper character in every word.","enabled":true},
  {"id":"manchester_mancunian","label":"Manchester Mancunian","promptLabel":"Manchester Mancunian","auditionLine":"Alright, mate. This is my voice, plain spoken and clear, with Manchester rhythm, grounded tone, and real feeling.","enabled":true},
  {"id":"nigerian_naija","label":"Nigerian Naija","promptLabel":"Nigerian Naija","auditionLine":"Hello o, this is my voice. I am speaking clearly with Naija energy, strong rhythm, confidence, and plenty feeling.","enabled":true},
  {"id":"northern_irish","label":"Northern Irish","promptLabel":"Northern Irish","auditionLine":"Here now, this is my voice. I am speaking clear and firm, with Northern Irish rhythm, sharp tone, and strong feeling.","enabled":true},
  {"id":"portuguese_brazilian","label":"Portuguese Brazilian","promptLabel":"Portuguese Brazilian","auditionLine":"Ola, meu amigo. This voice is warm, musical, and clear, with Brazilian rhythm, bright emotion, and open feeling.","enabled":true},
  {"id":"russian","label":"Russian","promptLabel":"Russian","auditionLine":"Hello, my friend. This voice is strong, serious, and clear, with deep tone, steady rhythm, and powerful emotion.","enabled":true},
  {"id":"singapore_singlish","label":"Singapore Singlish","promptLabel":"Singapore Singlish","auditionLine":"Hello lah, this is my voice. I speak clear-clear, with Singapore rhythm, confident tone, and steady emotion, can.","enabled":true},
  {"id":"spanish","label":"Spanish","promptLabel":"Spanish","auditionLine":"Hola, my friend. This is my voice, warm and clear, with Spanish rhythm, bright tone, and strong emotion in every word.","enabled":true},
  {"id":"texan","label":"Texan","promptLabel":"Texan","auditionLine":"Howdy, this is my voice. I am speaking clear and steady, with Texas warmth, confidence, and a strong honest feeling.","enabled":true},
  {"id":"trinidadian","label":"Trinidadian","promptLabel":"Trinidadian","auditionLine":"Ay, dis is meh voice. Ah speaking clear and lively, wid Trini rhythm, warm feeling, and plenty character inside.","enabled":true},
  {"id":"welsh","label":"Welsh","promptLabel":"Welsh","auditionLine":"Hello, this is my voice, it is. I am speaking clear, with Welsh warmth, musical rhythm, and feeling in every word.","enabled":true},
  {"id":"west_country","label":"West Country","promptLabel":"West Country","auditionLine":"Alright, me lover, this be my voice. I be speaking clear and warm, with West Country heart and steady feeling.","enabled":true},
  {"id":"yorkshire","label":"Yorkshire","promptLabel":"Yorkshire","auditionLine":"Ey up, this is me voice. I am speaking plain, warm, and clear, with Yorkshire heart and nowt fancy hiding the feeling.","enabled":true}
]
'@

try {
  $repo = (Resolve-Path -LiteralPath $RepoRoot).Path
  $modelsPath = Join-Path $repo "lib\characters\voiceDesignModels.ts"
  $panelPath = Join-Path $repo "app\app\components\CharactersPanel.tsx"
  $workerPath = Join-Path $repo "scripts\windows\otg-voice-ltx-worker.py"
  $workflowPath = Join-Path $repo "comfy_workflows\presets\LTX Voice Sample.json"
  $checklistPath = Join-Path $repo "docs\OTG_REWORK_CHECKLIST.md"
  $paths = @($modelsPath, $panelPath, $workerPath, $workflowPath, $checklistPath)
  foreach ($path in $paths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required file not found: $path" }
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupDir = Join-Path $repo ".patch-backups\ltx-accepted-dialects-final-$stamp"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  foreach ($path in $paths) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $backupDir (Split-Path -Leaf $path)) -Force
  }
  Write-Ok "Backed up files to $backupDir"

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $parsedDialects = $DialectJson | ConvertFrom-Json
  $dialects = @($parsedDialects)
  if ($dialects.Count -eq 1 -and $dialects[0] -is [System.Array]) {
    $dialects = @($dialects[0])
  }
  $dialects = @($dialects | Sort-Object label)
  if ($dialects.Count -ne 28) { throw "Expected 28 accepted LTX dialects, found $($dialects.Count)" }

  $modelText = [System.IO.File]::ReadAllText($modelsPath, [System.Text.Encoding]::UTF8) -replace "`r?`n", "`n"
  $start = 'export const LTX_VOICE_DIALECTS = ['
  $startIndex = $modelText.IndexOf($start)
  if ($startIndex -lt 0) { throw "LTX_VOICE_DIALECTS start anchor not found" }
  $helperStart = "export function getLtxDialectSampleText"
  $endIndex = $modelText.IndexOf($helperStart, $startIndex)
  if ($endIndex -lt 0) { throw "LTX_VOICE_DIALECTS boundary not found" }
  $dialectLines = foreach ($dialect in $dialects) {
    '  { id: "' + (Escape-Ts $dialect.id) + '", label: "' + (Escape-Ts $dialect.label) + '", promptLabel: "' + (Escape-Ts $dialect.promptLabel) + '", kind: "ltx_dialect", auditionLine: "' + (Escape-Ts $dialect.auditionLine) + '", enabled: true },'
  }
  $arrayBlock = "export const LTX_VOICE_DIALECTS = [`n" + ($dialectLines -join "`n") + "`n] as const satisfies readonly VoiceDesignOption[];"
  $modelText = $modelText.Substring(0, $startIndex) + $arrayBlock + "`n`n" + $modelText.Substring($endIndex).TrimStart()
  $modelText = $modelText.Replace('if (profile.model === "ltxvoice") return LTX_VOICE_DIALECTS;', 'if (profile.model === "ltxvoice") return [...LTX_VOICE_DIALECTS];')
  $modelText = $modelText.Replace('return normalized === DEFAULT_VOICE_SAMPLE_TEXT || LTX_VOICE_DIALECTS.some((dialect) => dialect.auditionLine === normalized || dialect.instruction === normalized);', 'return normalized === DEFAULT_VOICE_SAMPLE_TEXT || LTX_VOICE_DIALECTS.some((dialect) => dialect.auditionLine === normalized);')
  $modelText = $modelText.Replace('  const options = [`n    ...QWEN_OFFICIAL_PRESETS,', '  const options: VoiceDesignOption[] = [`n    ...QWEN_OFFICIAL_PRESETS,')
  Require-Contains $modelText "export const LTX_VOICE_NEGATIVE_PROMPT =" "LTX_VOICE_NEGATIVE_PROMPT"
  Require-Contains $modelText "export const DEFAULT_LTX_VOICE_DIALECT_ID = `"general_american`";" "DEFAULT_LTX_VOICE_DIALECT_ID"
  Require-Contains $modelText "function articleForLabel" "article helper"
  Require-Contains $modelText "buildLtxVoiceAuditionPrompt" "buildLtxVoiceAuditionPrompt"
  [System.IO.File]::WriteAllText($modelsPath, $modelText, $utf8NoBom)

  $panelText = [System.IO.File]::ReadAllText($panelPath, [System.Text.Encoding]::UTF8)
  Require-Contains $panelText "OTG_LTX_DIALECT_SAMPLE_SYNC" "OTG_LTX_DIALECT_SAMPLE_SYNC"
  Require-Contains $panelText "DEFAULT_LTX_VOICE_DIALECT_ID" "DEFAULT_LTX_VOICE_DIALECT_ID import/use"
  Require-Contains $panelText "ltxSampleTextIsCustom" "ltxSampleTextIsCustom"
  [System.IO.File]::WriteAllText($panelPath, $panelText, $utf8NoBom)

  $workerText = [System.IO.File]::ReadAllText($workerPath, [System.Text.Encoding]::UTF8)
  Require-Contains $workerText "OTG_LTX_VOICE_NEGATIVE_PROMPT" "worker negative marker"
  Require-Contains $workerText $NegativePrompt "worker negative prompt"
  Require-Contains $workerText 'set_input(graph, "370", "text", LTX_VOICE_NEGATIVE_PROMPT)' "worker node 370 patch"
  [System.IO.File]::WriteAllText($workerPath, $workerText, $utf8NoBom)

  $workflow = Get-Content -LiteralPath $workflowPath -Raw | ConvertFrom-Json
  if ($null -eq $workflow.PSObject.Properties["370"]) { throw "Workflow node 370 missing" }
  $workflow.PSObject.Properties["370"].Value.inputs.text = $NegativePrompt
  [System.IO.File]::WriteAllText($workflowPath, ($workflow | ConvertTo-Json -Depth 100) + "`r`n", $utf8NoBom)

  $checklist = Get-Content -LiteralPath $checklistPath -Raw
  $checklist = $checklist -replace "`r?`n", "`r`n"
  $checklistLine = "- [x] LTX Voice accepted dialect finalization: dropdown now exposes only the 28 accepted dialects, sample phrases use accepted audition lines, positive prompts avoid unwanted-audio wording, and node 370 receives the dedicated negative prompt."
  if (-not $checklist.Contains($checklistLine)) {
    $anchor = "- [x] LTX Voice Design picker UX: dialect options are alphabetized and the visible Sample phrase now syncs to the selected dialect line until manually edited."
    if (-not $checklist.Contains($anchor)) { throw "Checklist anchor not found" }
    $checklist = $checklist.Replace($anchor, "$anchor`r`n$checklistLine")
  }
  [System.IO.File]::WriteAllText($checklistPath, $checklist, [System.Text.UTF8Encoding]::new($true))

  $verifyModels = [System.IO.File]::ReadAllText($modelsPath, [System.Text.Encoding]::UTF8)
  $labels = @([regex]::Matches($verifyModels, '\{\s*id:\s*"[^"]+",\s*label:\s*"([^"]+)",\s*promptLabel:\s*"[^"]+",\s*kind:\s*"ltx_dialect",\s*auditionLine:\s*"[^"]+",\s*enabled:\s*true\s*\},') | ForEach-Object { $_.Groups[1].Value })
  if ($labels.Count -ne 28) { throw "Expected 28 LTX dialects after write, found $($labels.Count)" }
  $sortedLabels = @($labels | Sort-Object)
  for ($i = 0; $i -lt $labels.Count; $i++) {
    if ($labels[$i] -ne $sortedLabels[$i]) { throw "LTX dialects are not alphabetized at index ${i}" }
  }
  Require-Contains $verifyModels "Wah gwaan, mi friend. Dis ya voice bright like Kingston morning; mi talk wid heart, rhythm, and clear Jamaican feeling." "Jamaican accepted audition line"
  Require-Contains $verifyModels "] as const satisfies readonly VoiceDesignOption[];" "LTX_VOICE_DIALECTS as const"
  Require-Contains $verifyModels 'if (profile.model === "ltxvoice") return [...LTX_VOICE_DIALECTS];' "LTX accent options copy"
  Require-Contains $verifyModels 'const options: VoiceDesignOption[] = [' "typed selectedAccent options"
  Require-Contains $verifyModels "The voice should sound natural, clear, expressive, and emotionally alive." "positive prompt clean template"
  $positivePromptSection = $verifyModels.Substring($verifyModels.IndexOf("export function buildLtxVoiceAuditionPrompt"))
  foreach ($bad in @("no music", "no singing", "background noise", "sound effects", "overlapping voices", "choir", "instrumental")) {
    if ($positivePromptSection.Contains($bad)) { throw "Positive LTX prompt builder contains unwanted negative term: $bad" }
  }
  $verifyWorkflow = Get-Content -LiteralPath $workflowPath -Raw | ConvertFrom-Json
  if ($verifyWorkflow.PSObject.Properties["370"].Value.inputs.text -ne $NegativePrompt) { throw "Workflow node 370 negative prompt mismatch" }
  Write-Ok "LTX accepted dialect finalization markers verified"
}
catch {
  Write-Fail $_.Exception.Message
  exit 1
}
