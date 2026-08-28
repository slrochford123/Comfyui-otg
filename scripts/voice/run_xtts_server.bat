@echo off
setlocal

set "OTG_VOICE_SCRIPT_DIR=%~dp0"
set "PYTHON=C:\AI\Voices\XTTS\venv\Scripts\python.exe"
set "XTTS_HOST=127.0.0.1"
set "XTTS_PORT=7862"

REM Required by Coqui XTTS v2. This confirms the user accepts the applicable Coqui license terms.
REM If you do not accept the license terms, close this server and do not use XTTS v2.
set "COQUI_TOS_AGREED=1"

echo Starting XTTS server on http://%XTTS_HOST%:%XTTS_PORT%
echo Python: %PYTHON%
echo App dir: %OTG_VOICE_SCRIPT_DIR%
echo COQUI_TOS_AGREED=%COQUI_TOS_AGREED%

pushd "%OTG_VOICE_SCRIPT_DIR%"
"%PYTHON%" -m uvicorn xtts_server:app --host %XTTS_HOST% --port %XTTS_PORT% --app-dir "%OTG_VOICE_SCRIPT_DIR%"
popd

endlocal