@echo off
setlocal EnableExtensions

REM SLR Studios OTG - Qwen3-TTS API launcher v14
REM This is the service used by OTG TTS Video Dub at http://127.0.0.1:7863/synthesize.

set "REPO_ROOT=C:\AI\OTG-Test2"
set "API_SCRIPT=%REPO_ROOT%\scripts\voice\qwen3_tts_api.py"

set "QWEN3_ROOT=C:\AI\Voices\qwen 3"
set "QWEN3_VENV=%QWEN3_ROOT%\qwen3tts-env"
set "QWEN3_VENV_PY=%QWEN3_VENV%\Scripts\python.exe"
set "QWEN3_SITE=%QWEN3_VENV%\Lib\site-packages"

set "QWEN3_TTS_HOST=127.0.0.1"
set "QWEN3_TTS_PORT=7863"

REM Base model is required for arbitrary reference-audio voice cloning.
set "QWEN3_TTS_CLONE_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base"
set "QWEN3_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base"
set "QWEN3_TTS_CUSTOM_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
set "QWEN3_TTS_LANGUAGE=English"
set "QWEN3_TTS_DTYPE=bfloat16"
set "QWEN3_TTS_USE_FLASH=1"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"

echo [qwen3-tts-api] Script: %API_SCRIPT%
echo [qwen3-tts-api] Clone model: %QWEN3_TTS_CLONE_MODEL%

if not exist "%API_SCRIPT%" (
  echo [FAIL] Missing API script: %API_SCRIPT%
  pause
  exit /b 1
)

set "RUN_PY=%QWEN3_VENV_PY%"
set "NEEDS_PYTHONPATH=0"

"%QWEN3_VENV_PY%" -c "import sys; print(sys.executable)" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Qwen3 venv launcher is broken. Falling back to Seed-VC Python and injecting Qwen3 site-packages.
  set "RUN_PY=C:\AI\Voices\Seed-Vc\.venv\Scripts\python.exe"
  set "NEEDS_PYTHONPATH=1"
)

if not exist "%RUN_PY%" (
  echo [FAIL] No usable Python found.
  echo Tried:
  echo   %QWEN3_VENV_PY%
  echo   C:\AI\Voices\Seed-Vc\.venv\Scripts\python.exe
  pause
  exit /b 1
)

if "%NEEDS_PYTHONPATH%"=="1" (
  set "PYTHONPATH=%QWEN3_SITE%;%PYTHONPATH%"
  set "PATH=%QWEN3_VENV%\Scripts;%QWEN3_SITE%\torch\lib;%PATH%"
)

echo [qwen3-tts-api] Runtime Python: %RUN_PY%
echo [qwen3-tts-api] Checking imports...
"%RUN_PY%" -c "import sys, torch, soundfile, fastapi; print('[OK] Python:', sys.executable); print('[OK] Torch:', torch.__version__); print('[OK] CUDA:', torch.cuda.is_available()); print('[OK] GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); import qwen_tts; print('[OK] qwen_tts import works')"
if errorlevel 1 (
  echo [FAIL] Qwen3-TTS API dependency check failed.
  pause
  exit /b 1
)

echo.
echo [qwen3-tts-api] Starting service at http://127.0.0.1:7863
echo [qwen3-tts-api] Health: http://127.0.0.1:7863/health
echo.

"%RUN_PY%" "%API_SCRIPT%"
pause
exit /b %errorlevel%
