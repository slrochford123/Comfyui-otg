@echo off
setlocal EnableExtensions

REM SLR Studios OTG - Qwen3-TTS API launcher - zlib/venv-safe version
REM Service endpoint: http://127.0.0.1:7863/synthesize

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

if not exist "%QWEN3_VENV_PY%" (
  echo [FAIL] Missing Qwen3 venv Python:
  echo   %QWEN3_VENV_PY%
  echo.
  echo Recreate or repair this venv. Do not fall back to Seed-VC Python for Qwen3.
  pause
  exit /b 1
)

REM Read the base Python home from pyvenv.cfg. A broken/moved base Python is the
REM common cause of "zlib1.dll was not found" before any Python code runs.
set "QWEN3_BASE_HOME="
if exist "%QWEN3_VENV%\pyvenv.cfg" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B /I "home =" "%QWEN3_VENV%\pyvenv.cfg"') do set "QWEN3_BASE_HOME=%%B"
  for /f "tokens=* delims= " %%A in ("%QWEN3_BASE_HOME%") do set "QWEN3_BASE_HOME=%%A"
)

REM Put the venv, base Python, Python DLLs, and Torch native libraries first.
if not "%QWEN3_BASE_HOME%"=="" (
  set "PATH=%QWEN3_BASE_HOME%;%QWEN3_BASE_HOME%\DLLs;%PATH%"
)
set "PATH=%QWEN3_VENV%\Scripts;%QWEN3_VENV%;%QWEN3_VENV%\DLLs;%QWEN3_VENV%\Library\bin;%QWEN3_SITE%\torch\lib;%PATH%"
set "PYTHONPATH="

echo [qwen3-tts-api] Venv Python: %QWEN3_VENV_PY%
if not "%QWEN3_BASE_HOME%"=="" echo [qwen3-tts-api] Base Python home: %QWEN3_BASE_HOME%
echo [qwen3-tts-api] Checking Python/zlib startup...

"%QWEN3_VENV_PY%" -c "import sys, zlib; print('[OK] Python:', sys.executable); print('[OK] zlib:', zlib.ZLIB_VERSION)"
if errorlevel 1 (
  echo.
  echo [FAIL] Qwen3 venv Python cannot start cleanly.
  echo This usually means pyvenv.cfg points to a moved/broken base Python, or zlib1.dll is missing from that base Python install.
  echo.
  echo Fix:
  echo   1. Open: %QWEN3_VENV%\pyvenv.cfg
  echo   2. Check the "home =" path.
  echo   3. Repair/reinstall that same Python version, or recreate qwen3tts-env with a working Python.
  echo.
  echo Do not copy zlib1.dll from random DLL sites.
  pause
  exit /b 1
)

echo [qwen3-tts-api] Checking imports...
"%QWEN3_VENV_PY%" -c "import sys, torch, soundfile, fastapi; print('[OK] Torch:', torch.__version__); print('[OK] CUDA:', torch.cuda.is_available()); print('[OK] GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); import qwen_tts; print('[OK] qwen_tts import works')"
if errorlevel 1 (
  echo [FAIL] Qwen3-TTS API dependency check failed.
  pause
  exit /b 1
)

echo.
echo [qwen3-tts-api] Starting service at http://127.0.0.1:7863
echo [qwen3-tts-api] Health: http://127.0.0.1:7863/health
echo.

"%QWEN3_VENV_PY%" "%API_SCRIPT%"
pause
exit /b %errorlevel%
