@echo off
setlocal EnableExtensions

REM SLR Studios OTG - Qwen3-TTS UI launcher v14
REM Starts your existing Qwen3-TTS Gradio UI. This is a UI launcher, not the OTG /synthesize API service.

set "QWEN3_ROOT=C:\AI\Voices\qwen 3"
set "QWEN3_VENV=%QWEN3_ROOT%\qwen3tts-env"
set "QWEN3_VENV_PY=%QWEN3_VENV%\Scripts\python.exe"
set "QWEN3_SITE=%QWEN3_VENV%\Lib\site-packages"
set "QWEN3_UI_1=%QWEN3_ROOT%\qwen3tts_unified_ui.py"
set "QWEN3_UI_2=C:\AI\OTG-Test2\scripts\voice\qwen3tts_unified_ui.py"

echo [qwen3-tts] Root: %QWEN3_ROOT%
echo [qwen3-tts] Venv Python: %QWEN3_VENV_PY%

if not exist "%QWEN3_ROOT%" (
  echo [FAIL] Qwen3 root not found: %QWEN3_ROOT%
  pause
  exit /b 1
)

set "QWEN3_UI="
if exist "%QWEN3_UI_1%" set "QWEN3_UI=%QWEN3_UI_1%"
if "%QWEN3_UI%"=="" if exist "%QWEN3_UI_2%" set "QWEN3_UI=%QWEN3_UI_2%"

if "%QWEN3_UI%"=="" (
  echo [FAIL] Could not find qwen3tts_unified_ui.py.
  echo Expected:
  echo   %QWEN3_UI_1%
  echo   %QWEN3_UI_2%
  pause
  exit /b 1
)

set "QWEN3_RUN_PY=%QWEN3_VENV_PY%"
set "QWEN3_NEEDS_PYTHONPATH=0"

echo.
echo [qwen3-tts] Testing Qwen3 venv Python...
"%QWEN3_VENV_PY%" -c "import sys; print(sys.executable)" >nul 2>nul
if errorlevel 1 (
  echo [WARN] Qwen3 venv launcher is broken. It likely points to a removed base Python.
  echo [WARN] Falling back to Seed-VC Python and injecting Qwen3 site-packages.
  set "QWEN3_RUN_PY=C:\AI\Voices\Seed-Vc\.venv\Scripts\python.exe"
  set "QWEN3_NEEDS_PYTHONPATH=1"
)

if not exist "%QWEN3_RUN_PY%" (
  echo [FAIL] No usable Python found.
  echo Tried:
  echo   %QWEN3_VENV_PY%
  echo   C:\AI\Voices\Seed-Vc\.venv\Scripts\python.exe
  pause
  exit /b 1
)

if "%QWEN3_NEEDS_PYTHONPATH%"=="1" (
  set "PYTHONPATH=%QWEN3_SITE%;%PYTHONPATH%"
  set "PATH=%QWEN3_VENV%\Scripts;%QWEN3_SITE%\torch\lib;%PATH%"
)

set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"

echo [qwen3-tts] UI script: %QWEN3_UI%
echo [qwen3-tts] Runtime Python: %QWEN3_RUN_PY%
echo [qwen3-tts] Checking CUDA and qwen_tts import...

"%QWEN3_RUN_PY%" -c "import sys, torch; print('[OK] Python:', sys.executable); print('[OK] Torch:', torch.__version__); print('[OK] CUDA:', torch.cuda.is_available()); print('[OK] GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only'); import qwen_tts; print('[OK] qwen_tts import works')"
if errorlevel 1 (
  echo [FAIL] Qwen3-TTS Python check failed.
  echo.
  echo The qwen3tts-env is broken or its packages are incomplete.
  echo Most likely cause: pyvenv.cfg points to C:\Program Files\Python310\python.exe, which does not exist.
  pause
  exit /b 1
)

echo.
echo [qwen3-tts] Starting Qwen3-TTS UI...
echo [qwen3-tts] Expected URL: http://127.0.0.1:8000
echo.

"%QWEN3_RUN_PY%" "%QWEN3_UI%"
pause
exit /b %errorlevel%
