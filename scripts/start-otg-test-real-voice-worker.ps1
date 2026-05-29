$ErrorActionPreference = "Continue"
cd "C:\AI\OTG-Test2"

$env:OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE = "1"
$env:OTG_ENABLE_REAL_COSY_VOICE_SAMPLE = "1"
$env:OTG_ENABLE_REAL_VOICE_FX = "1"
$env:NEXT_PUBLIC_OTG_ALLOW_MOCK_VOICE_TRAINING = "0"
$env:OTG_OWNER_ALIASES = "slrochford:slrochford12300"

$env:QWEN_TTS_ROOT = "C:\AI\voices\qwen 3"
$env:QWEN_TTS_PYTHON = "C:\Users\SLRoc\miniconda3\envs\qwen3tts-repair\python.exe"
$env:QWEN_TTS_SITE_PACKAGES = "C:\AI\voices\qwen 3\qwen3tts-env\Lib\site-packages"
$env:QWEN_TTS_BRIDGE = "C:\AI\OTG-Test2\scripts\qwen3_voice_design_preview.py"
$env:QWEN_TTS_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
$env:QWEN_TTS_PREVIEW_TIMEOUT_MS = "600000"

$env:COSYVOICE_ROOT = "C:\AI\Voices\cosyvoice"
$env:COSYVOICE_PYTHON = "C:\Users\SLRoc\miniconda3\envs\voices-cosy\python.exe"
$env:COSYVOICE_SITE_PACKAGES = ""
$env:COSYVOICE_BRIDGE = "C:\AI\OTG-Test2\scripts\cosy_voice_sample_bridge.py"
$env:COSYVOICE_MODEL_ID = "Fun-CosyVoice3-0.5B"
$env:COSYVOICE_TIMEOUT_MS = "600000"

$env:OTG_VOICE_PACK_CLONE_PROVIDER = "indextts2"
$env:OTG_REQUIRE_INDEXTTS2_FOR_VOICE_PACK = "1"
$env:INDEXTTS2_ROOT = "C:\AI\Voices\IndexTTS2"
$env:INDEXTTS2_PYTHON = "C:\AI\Voices\IndexTTS2\.venv\Scripts\python.exe"
$env:INDEXTTS2_CFG = "C:\AI\Voices\IndexTTS2\checkpoints\config.yaml"
$env:INDEXTTS2_MODEL_DIR = "C:\AI\Voices\IndexTTS2\checkpoints"
$env:INDEXTTS2_EMO_ALPHA = "0.45"
$env:INDEXTTS2_USE_FP16 = "0"
$env:INDEXTTS2_USE_CUDA_KERNEL = "0"
$env:INDEXTTS2_USE_DEEPSPEED = "0"

$LogRoot = "C:\AI\OTG-Test2\data\worker-logs"
$LockPath = "C:\AI\OTG-Test2\data\voice-worker-daemon.lock.json"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

$lock = [ordered]@{
  name = "otg-test-real-voice-worker-loop"
  pid = $PID
  startedAt = (Get-Date).ToString("o")
  owner = "slrochford12300"
  realQwen3 = $env:OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE
  realCosy = $env:OTG_ENABLE_REAL_COSY_VOICE_SAMPLE
  realVoiceFx = $env:OTG_ENABLE_REAL_VOICE_FX
}
$lock | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $LockPath -Encoding UTF8

Write-Host "[OK] Real voice worker loop started"
Write-Host "[OK] Lock: $LockPath"
Write-Host "[OK] Logs: $LogRoot"

while ($true) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $log = Join-Path $LogRoot "voice-worker-once-$stamp.log"

  Write-Host "[INFO] Running one voice worker pass..."
  npm run voice-worker:once -- --owner slrochford12300 --limit 1 *> $log

  if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Worker pass exited with code $LASTEXITCODE. See $log"
  } else {
    Write-Host "[OK] Worker pass completed. See $log"
  }

  Start-Sleep -Seconds 2
}
