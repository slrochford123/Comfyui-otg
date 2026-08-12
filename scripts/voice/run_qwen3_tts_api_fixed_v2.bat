@echo off
setlocal EnableExtensions

REM SLR Studios OTG - Qwen3-TTS API launcher - v2 logging/port diagnostics
REM Service endpoint: http://127.0.0.1:7863/synthesize

set "REPO_ROOT=C:\AI\OTG-Test2"
set "API_SCRIPT=%REPO_ROOT%\scripts\voice\qwen3_tts_api.py"

set "QWEN3_ROOT=C:\AI\Voices\qwen 3"
set "QWEN3_VENV=%QWEN3_ROOT%\qwen3tts-env"
set "QWEN3_VENV_PY=%QWEN3_VENV%\Scripts\python.exe"
set "QWEN3_SITE=%QWEN3_VENV%\Lib\site-packages"
set "LOG_DIR=%REPO_ROOT%\logs"
set "LOG_FILE=%LOG_DIR%\qwen3_tts_api_7863.log"

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
set "PYTHONFAULTHANDLER=1"
set "PYTHONUNBUFFERED=1"

echo [qwen3-tts-api] Script: %API_SCRIPT%
echo [qwen3-tts-api] Clone model: %QWEN3_TTS_CLONE_MODEL%

if not exist "%API_SCRIPT%" (
  echo [FAIL] Missing API script: %API_SCRIPT%
  pause
  exit /b 1
)

if not exist "%QWEN3_VENV_PY%" (
  echo [FAIL] Missing Qwen3 venv Python:
  echo   %QWEN3_VENV_PY%
  pause
  exit /b 1
)

set "QWEN3_BASE_HOME="
if exist "%QWEN3_VENV%\pyvenv.cfg" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B /I "home =" "%QWEN3_VENV%\pyvenv.cfg"') do set "QWEN3_BASE_HOME=%%B"
  for /f "tokens=* delims= " %%A in ("%QWEN3_BASE_HOME%") do set "QWEN3_BASE_HOME=%%A"
)

if not "%QWEN3_BASE_HOME%"=="" (
  set "PATH=%QWEN3_BASE_HOME%;%QWEN3_BASE_HOME%\DLLs;%QWEN3_BASE_HOME%\Library\bin;%PATH%"
)
set "PATH=%QWEN3_VENV%\Scripts;%QWEN3_VENV%;%QWEN3_VENV%\DLLs;%QWEN3_VENV%\Library\bin;%QWEN3_SITE%\torch\lib;%PATH%"
set "PYTHONPATH="

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [qwen3-tts-api] Venv Python: %QWEN3_VENV_PY%
if not "%QWEN3_BASE_HOME%"=="" echo [qwen3-tts-api] Base Python home: %QWEN3_BASE_HOME%
echo [qwen3-tts-api] Log file: %LOG_FILE%
echo [qwen3-tts-api] Checking Python/zlib startup...

"%QWEN3_VENV_PY%" -X faulthandler -c "import sys, zlib; print('[OK] Python:', sys.executable); print('[OK] zlib:', zlib.ZLIB_VERSION)"
if errorlevel 1 (
  echo [FAIL] Python/zlib startup failed.
  pause
  exit /b 1
)

echo [qwen3-tts-api] Checking imports...
"%QWEN3_VENV_PY%" -X faulthandler -c "import sys, torch, soundfile, fastapi, uvicorn; print('[OK] Torch:', torch.__version__); print('[OK] CUDA:', torch.cuda.is_available()); print('[OK] GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); import qwen_tts; print('[OK] qwen_tts import works')"
if errorlevel 1 (
  echo [FAIL] Qwen3-TTS API dependency check failed.
  pause
  exit /b 1
)

echo [qwen3-tts-api] Checking whether port 7863 is already in use...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":7863" ^| findstr "LISTENING"') do (
  echo [FAIL] Port 7863 is already in use by PID %%P.
  echo Close the existing server, or change QWEN3_TTS_PORT.
  pause
  exit /b 1
)

echo.
echo [qwen3-tts-api] Starting service at http://127.0.0.1:7863
echo [qwen3-tts-api] Health: http://127.0.0.1:7863/health
echo.

"%QWEN3_VENV_PY%" -X faulthandler "%API_SCRIPT%" > "%LOG_FILE%" 2>&1

set "ERR=%errorlevel%"
echo.
echo [qwen3-tts-api] Server process exited with code %ERR%.
echo [qwen3-tts-api] Last 80 log lines:
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%LOG_FILE%') { Get-Content -LiteralPath '%LOG_FILE%' -Tail 80 } else { Write-Host 'No log file found.' }"
echo.
pause
exit /b %ERR%
