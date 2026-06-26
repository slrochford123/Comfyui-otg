@echo off
setlocal EnableExtensions

set "SERVICE_ROOT=%~dp0"
set "VENV_PY=%SERVICE_ROOT%.venv\Scripts\python.exe"
set "PYANNOTE_HOST=127.0.0.1"
set "PYANNOTE_PORT=9010"

if not exist "%VENV_PY%" (
  echo [speaker-diarization] Missing venv:
  echo   %VENV_PY%
  echo.
  echo Run:
  echo   powershell -ExecutionPolicy Bypass -File "%SERVICE_ROOT%install_speaker_diarization.ps1"
  pause
  exit /b 1
)

if "%PYANNOTE_AUTH_TOKEN%"=="" if "%HF_TOKEN%"=="" if "%HUGGINGFACE_TOKEN%"=="" (
  echo [speaker-diarization] WARNING: No Hugging Face token found.
  echo Set PYANNOTE_AUTH_TOKEN or HF_TOKEN before analyzing clips.
  echo.
)

echo [speaker-diarization] Starting pyannote worker.
echo [speaker-diarization] URL: http://%PYANNOTE_HOST%:%PYANNOTE_PORT%/diarize
echo [speaker-diarization] Health: http://%PYANNOTE_HOST%:%PYANNOTE_PORT%/health
echo.

cd /d "%SERVICE_ROOT%"
"%VENV_PY%" -m uvicorn app:app --host %PYANNOTE_HOST% --port %PYANNOTE_PORT%

echo.
echo [speaker-diarization] Process exited.
pause
