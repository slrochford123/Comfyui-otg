@echo off
setlocal EnableExtensions

REM SLR Studios OTG - Qwen3-TTS API launcher - clean venv only
REM No Seed-VC fallback. No Conda package-cache injection.

set "REPO_ROOT=C:\AI\OTG-Test2"
set "API_SCRIPT=%REPO_ROOT%\scripts\voice\qwen3_tts_api.py"

set "QWEN3_ROOT=C:\AI\Voices\qwen 3"
set "QWEN3_VENV=%QWEN3_ROOT%\qwen3tts-env"
set "RUN_PY=%QWEN3_VENV%\Scripts\python.exe"
set "LOG_DIR=%REPO_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\qwen3_tts_api_7863.log"

set "QWEN3_TTS_HOST=127.0.0.1"
set "QWEN3_TTS_PORT=7863"
set "QWEN3_TTS_CLONE_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base"
set "QWEN3_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base"
set "QWEN3_TTS_CUSTOM_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
set "QWEN3_TTS_LANGUAGE=English"
set "QWEN3_TTS_DTYPE=bfloat16"
set "QWEN3_TTS_USE_FLASH=0"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "PYTHONFAULTHANDLER=1"
set "PYTHONUNBUFFERED=1"
set "PYTHONPATH="

echo [qwen3-tts-api] Script: %API_SCRIPT%
echo [qwen3-tts-api] Python: %RUN_PY%
echo [qwen3-tts-api] Clone model: %QWEN3_TTS_CLONE_MODEL%

if not exist "%API_SCRIPT%" (
  echo [FAIL] Missing API script: %API_SCRIPT%
  pause
  exit /b 1
)

if not exist "%RUN_PY%" (
  echo [FAIL] Missing repaired Qwen3 Python:
  echo   %RUN_PY%
  echo Run:
  echo   powershell -ExecutionPolicy Bypass -File C:\AI\OTG-Test2\scripts\voice\repair_qwen3tts_env.ps1
  pause
  exit /b 1
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [qwen3-tts-api] Checking Python core...
"%RUN_PY%" -c "import sys, encodings, zlib; print('[OK] Python:', sys.executable); print('[OK] zlib:', zlib.ZLIB_VERSION)"
if errorlevel 1 (
  echo [FAIL] Python core check failed. Rebuild qwen3tts-env.
  pause
  exit /b 1
)

echo [qwen3-tts-api] Checking Qwen/API imports...
"%RUN_PY%" -c "import torch, soundfile, fastapi, uvicorn; from qwen_tts import Qwen3TTSModel; print('[OK] torch:', torch.__version__); print('[OK] CUDA:', torch.cuda.is_available()); print('[OK] GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); print('[OK] Qwen3TTSModel import works')"
if errorlevel 1 (
  echo [FAIL] Qwen3-TTS dependency check failed.
  pause
  exit /b 1
)

echo [qwen3-tts-api] Checking whether port 7863 is already in use...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7863" ^| findstr "LISTENING"') do (
  echo [FAIL] Port 7863 is already in use by PID %%P.
  pause
  exit /b 1
)

echo.
echo [qwen3-tts-api] Starting service at http://127.0.0.1:7863
echo [qwen3-tts-api] Health: http://127.0.0.1:7863/health
echo [qwen3-tts-api] Log file: %LOG_FILE%
echo.

"%RUN_PY%" "%API_SCRIPT%" > "%LOG_FILE%" 2>&1

set "ERR=%errorlevel%"
echo.
echo [qwen3-tts-api] Server process exited with code %ERR%.
echo [qwen3-tts-api] Last 120 log lines:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%LOG_FILE%') { Get-Content -LiteralPath '%LOG_FILE%' -Tail 120 } else { Write-Host 'No log file found.' }"
echo.
pause
exit /b %ERR%
