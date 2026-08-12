param(
  [string]$Owner = "slrochford12300",
  [int]$Limit = 20,
  [string]$Qwen3Url = "http://127.0.0.1:7863/synthesize"
)

$ErrorActionPreference = "Continue"

$Repo = "C:\AI\OTG-Test2"
Set-Location $Repo

$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$env:OTG_REQUIRE_REAL_VOICE = "1"

$JobStore = Join-Path $Repo "data\voice-pipeline-jobs.json"
$LogRoot = Join-Path $Repo "data\worker-logs"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

$LogPath = Join-Path $LogRoot ("real-create-voice-" + (Get-Date -Format "yyyyMMdd") + ".log")

function Write-Log {
  param([string]$Message)
  $Line = "[" + (Get-Date).ToString("s") + "] " + $Message
  Add-Content -Path $LogPath -Value $Line -Encoding UTF8
  Write-Host $Line
}

function Get-Prop {
  param([object]$Object, [string]$Name, [object]$Default = $null)

  if ($null -eq $Object) { return $Default }
  $Prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $Prop -or $null -eq $Prop.Value) { return $Default }
  return $Prop.Value
}

function Get-Deep {
  param([object]$Object, [string[]]$Path, [object]$Default = $null)

  $Current = $Object
  foreach ($Part in $Path) {
    if ($null -eq $Current) { return $Default }
    $Prop = $Current.PSObject.Properties[$Part]
    if ($null -eq $Prop) { return $Default }
    $Current = $Prop.Value
  }

  if ($null -eq $Current) { return $Default }
  return $Current
}

function Set-JobFields {
  param([object]$Job, [hashtable]$Fields)

  foreach ($Key in $Fields.Keys) {
    $Existing = $Job.PSObject.Properties[$Key]
    if ($Existing) {
      $Existing.Value = $Fields[$Key]
    }
    else {
      $Job | Add-Member -NotePropertyName $Key -NotePropertyValue $Fields[$Key]
    }
  }
}

function Save-Store {
  param([object]$Store)

  $Json = $Store | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($JobStore, $Json, [System.Text.UTF8Encoding]::new($false))
}

function Test-Qwen3Health {
  try {
    $HealthUrl = $Qwen3Url -replace "/synthesize$", "/health"
    $Response = Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 10
    return ($Response.ok -eq $true)
  }
  catch {
    return $false
  }
}

function Invoke-Qwen3Synthesize {
  param(
    [string]$Text,
    [string]$OutputPath,
    [string]$Language,
    [string]$Instruct,
    [string]$Speaker,
    [string]$ReferencePath,
    [string]$ReferenceText
  )

  Add-Type -AssemblyName System.Net.Http | Out-Null

  $Client = [System.Net.Http.HttpClient]::new()
  $Client.Timeout = [TimeSpan]::FromMinutes(45)

  $Form = [System.Net.Http.MultipartFormDataContent]::new()
  $Form.Add([System.Net.Http.StringContent]::new($Text), "text")
  $Form.Add([System.Net.Http.StringContent]::new($OutputPath), "output_path")
  $Form.Add([System.Net.Http.StringContent]::new($Language), "language")

  if (![string]::IsNullOrWhiteSpace($Instruct)) {
    $Form.Add([System.Net.Http.StringContent]::new($Instruct), "instruct")
  }

  if (![string]::IsNullOrWhiteSpace($Speaker)) {
    $Form.Add([System.Net.Http.StringContent]::new($Speaker), "speaker")
  }

  if (![string]::IsNullOrWhiteSpace($ReferencePath)) {
    $Form.Add([System.Net.Http.StringContent]::new($ReferencePath), "speaker_path")
  }

  if (![string]::IsNullOrWhiteSpace($ReferenceText)) {
    $Form.Add([System.Net.Http.StringContent]::new($ReferenceText), "ref_text")
  }

  $Response = $Client.PostAsync($Qwen3Url, $Form).Result
  $Body = $Response.Content.ReadAsStringAsync().Result

  if (!$Response.IsSuccessStatusCode) {
    throw "Qwen3 synthesize HTTP $([int]$Response.StatusCode): $Body"
  }

  $Parsed = $Body | ConvertFrom-Json
  if ($Parsed.ok -ne $true) {
    throw "Qwen3 synthesize returned ok=false: $Body"
  }

  if (!(Test-Path $OutputPath)) {
    throw "Qwen3 reported success but output file does not exist: $OutputPath"
  }

  $Size = (Get-Item $OutputPath).Length
  if ($Size -le 1024) {
    throw "Qwen3 output file is too small to be valid audio: $OutputPath size=$Size"
  }

  return $Parsed
}

if (!(Test-Path $JobStore)) {
  Write-Log "[SKIP] Missing job store: $JobStore"
  exit 0
}

try {
  $Store = Get-Content $JobStore -Raw | ConvertFrom-Json
}
catch {
  Write-Log "[FAIL] Could not read job store: $($_.Exception.Message)"
  exit 1
}

$Jobs = @()
if ($Store.PSObject.Properties["jobs"] -and $Store.jobs -is [System.Array]) {
  $Jobs = @($Store.jobs)
}
elseif ($Store -is [System.Array]) {
  $Jobs = @($Store)
}
else {
  Write-Log "[FAIL] Unsupported voice-pipeline-jobs.json structure."
  exit 1
}

if (!(Test-Qwen3Health)) {
  Write-Log "[FAIL] Qwen3 API is not healthy at $Qwen3Url. Real create voice cannot run."
  exit 2
}

$Processed = 0

foreach ($Job in $Jobs) {
  if ($Processed -ge $Limit) { break }

  $Status = [string](Get-Prop $Job "status" "")
  if ($Status -ne "queued") { continue }

  $OwnerKey = [string](Get-Prop $Job "ownerKey" $Owner)
  if ($OwnerKey -ne $Owner) { continue }

  $JobId = [string](Get-Prop $Job "jobId" "")
  if ([string]::IsNullOrWhiteSpace($JobId)) { continue }

  $Action = [string](Get-Prop $Job "action" "")
  $Provider = [string](Get-Prop $Job "provider" "")
  $RequestProvider = [string](Get-Deep $Job @("request", "provider") "")
  $PromptProvider = [string](Get-Deep $Job @("request", "promptSnapshot", "provider") "")
  $PayloadProvider = [string](Get-Deep $Job @("request", "promptSnapshot", "payload", "provider") "")
  $Model = [string](Get-Deep $Job @("request", "promptSnapshot", "payload", "model") "")

  $LooksLikeCreateVoice =
    $Action -eq "create_voice_sample" -or
    $Provider -match "qwen|cosy|cozy" -or
    $RequestProvider -match "qwen|cosy|cozy" -or
    $PromptProvider -match "qwen|cosy|cozy" -or
    $PayloadProvider -match "qwen|cosy|cozy" -or
    $Model -match "qwen3-tts"

  if (!$LooksLikeCreateVoice) { continue }

  $CharacterId = [string](Get-Prop $Job "characterId" "")
  if ([string]::IsNullOrWhiteSpace($CharacterId)) {
    $CharacterId = [string](Get-Deep $Job @("request", "characterId") "")
  }
  if ([string]::IsNullOrWhiteSpace($CharacterId)) {
    $CharacterId = "unknown-character"
  }

  $Payload = Get-Deep $Job @("request", "promptSnapshot", "payload") $null
  $PromptSnapshot = Get-Deep $Job @("request", "promptSnapshot") $null
  $VoiceDesign = Get-Deep $Job @("request", "promptSnapshot", "voiceDesign") $null

  $Text = [string](Get-Deep $Job @("request", "text") "")
  if ([string]::IsNullOrWhiteSpace($Text)) { $Text = [string](Get-Deep $Job @("request", "sampleText") "") }
  if ([string]::IsNullOrWhiteSpace($Text)) { $Text = [string](Get-Prop $Payload "text" "") }
  if ([string]::IsNullOrWhiteSpace($Text)) { $Text = [string](Get-Prop $PromptSnapshot "text" "") }
  if ([string]::IsNullOrWhiteSpace($Text)) {
    $Text = "Hello, this is my character voice. I am speaking clearly at a natural pace so you can hear the tone, age, pitch, and emotion of the voice."
  }

  $Instruct = [string](Get-Prop $Payload "instruct" "")
  if ([string]::IsNullOrWhiteSpace($Instruct)) { $Instruct = [string](Get-Prop $PromptSnapshot "instruct" "") }

  $Language = [string](Get-Prop $Payload "language" "")
  if ([string]::IsNullOrWhiteSpace($Language)) { $Language = [string](Get-Prop $VoiceDesign "language" "") }
  if ([string]::IsNullOrWhiteSpace($Language)) { $Language = "English" }

  $Speaker = [string](Get-Prop $Payload "speaker" "")
  if ([string]::IsNullOrWhiteSpace($Speaker)) { $Speaker = [string](Get-Prop $VoiceDesign "qwenPresetSpeaker" "") }

  $ReferencePath = [string](Get-Prop $Payload "referenceAudio" "")
  if ([string]::IsNullOrWhiteSpace($ReferencePath)) { $ReferencePath = [string](Get-Prop $Payload "reference_path" "") }

  $ReferenceText = [string](Get-Prop $VoiceDesign "referenceText" "")

  $OutDir = Join-Path $Repo ("data\characters\{0}\voice-samples\{1}\{2}" -f $OwnerKey, $CharacterId, $JobId)
  $LogsDir = Join-Path $OutDir "logs"
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

  $OutputPath = Join-Path $OutDir "sample.wav"
  $SampleUrl = "/api/characters/voice-sample/file?owner=$OwnerKey&characterId=$CharacterId&jobId=$JobId&file=sample.wav"

  Write-Log "[RUN] Real Qwen3 create voice job=$JobId character=$CharacterId output=$OutputPath"

  Set-JobFields $Job @{
    status = "running"
    progress = 20
    message = "Real Qwen3 voice generation started."
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    error = $null
  }
  Save-Store $Store

  try {
    $Result = Invoke-Qwen3Synthesize `
      -Text $Text `
      -OutputPath $OutputPath `
      -Language $Language `
      -Instruct $Instruct `
      -Speaker $Speaker `
      -ReferencePath $ReferencePath `
      -ReferenceText $ReferenceText

    $ResultJsonPath = Join-Path $LogsDir "qwen3-create-voice-result.json"
    $Result | ConvertTo-Json -Depth 30 | Set-Content -Path $ResultJsonPath -Encoding UTF8

    $FinalResult = [ordered]@{
      mock = $false
      adapter = "qwen3_real_synthesize"
      provider = "qwen3"
      sampleUrl = $SampleUrl
      samplePath = $OutputPath
      outputPath = $OutputPath
      resultPath = $ResultJsonPath
      text = $Text
      language = $Language
      status = "voice_ready"
    }

    Set-JobFields $Job @{
      status = "completed"
      progress = 100
      message = "Real Qwen3 voice sample ready. samplePath: $OutputPath"
      result = $FinalResult
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
      error = $null
    }

    Save-Store $Store
    Write-Log "[OK] Real Qwen3 create voice completed job=$JobId"
    $Processed++
  }
  catch {
    $ErrorText = [string]$_.Exception.Message
    Write-Log "[FAIL] Real Qwen3 create voice failed job=$JobId error=$ErrorText"

    Set-JobFields $Job @{
      status = "failed"
      progress = 100
      message = "Real Qwen3 voice generation failed."
      result = $null
      error = $ErrorText
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    Save-Store $Store
    $Processed++
  }
}

Write-Log "[DONE] Real create voice pass processed=$Processed"
exit 0
