$ErrorActionPreference = "Stop"
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

$env:PORT = "3001"

Write-Host "[OK] Starting OTG TEST app on port 3001 with real Qwen3/Cosy voice enabled"
npm run dev
