@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM ============================================================
REM SLR Studios OTG TEST - Stable Service Launcher v2
REM Repo: C:\AI\OTG-Test2
REM Purpose:
REM   Start TEST app services in separate persistent cmd windows.
REM   This launcher should not close before reporting what happened.
REM ============================================================

set "REPO_ROOT=C:\AI\OTG-Test2"

REM Core services
set "START_COMFY_3090=1"
set "START_COMFY_5060TI=1"
set "START_WHISPER=1"
set "START_XTTS=1"
set "START_QWEN3_API=1"
set "START_COSYVOICE=1"
set "START_BG_REMOVE=1"
set "START_NEXT_TEST=1"
set "START_VOICE_DATASET_WORKER=1"
set "START_VOICE_APPLIO_WORKER=1"
set "START_CHARACTER_PREVIEW_WORKER=1"



REM Music generation
set "START_ACE_STEP_15_UI=1"
set "START_ACE_STEP_15_API=0"

REM Optional manual voice tools
set "START_SEEDVC_UI=0"
set "START_QWEN3_UI=0"

REM Applio UI remains disabled. OTG training uses the dedicated worker below.
set "START_APPLIO_UI=0"

set "COMFY_3090_BAT=C:\AI\Comfyui\ComfyUI - 3090.bat"
set "COMFY_5060TI_BAT=C:\AI\Comfyui\ComfyUI - 5060ti.bat"
set "WHISPER_BAT=C:\AI\Services\whisper\run_whisper_server.bat"
set "XTTS_BAT=%REPO_ROOT%\scripts\voice\run_xtts_server.bat"
set "QWEN3_API_BAT=%REPO_ROOT%\scripts\voice\run_qwen3_tts_api.bat"
set "QWEN3_UI_BAT=%REPO_ROOT%\scripts\voice\run_qwen3_tts_ui.bat"
set "SEEDVC_BAT=%REPO_ROOT%\scripts\voice\run_seedvc.bat"
set "BG_REMOVE_BAT=%REPO_ROOT%\services\bg_remove\run_bg_remove.bat"
set "VOICE_DATASET_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-dataset-worker.ps1"
set "VOICE_APPLIO_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-voice-applio-worker.ps1"
set "CHARACTER_PREVIEW_WORKER_PS1=%REPO_ROOT%\scripts\windows\otg-character-preview-worker.ps1"

set "COSYVOICE_ROOT=C:\AI\Voices\cosyvoice"
set "COSYVOICE_PYTHON=C:\Users\SLRoc\miniconda3\envs\voices-cosy\python.exe"
set "COSYVOICE_BAT=%REPO_ROOT%\scripts\voice\run_cosyvoice_server.bat"
set "COSYVOICE_BRIDGE=%REPO_ROOT%\scripts\cosy_voice_sample_bridge.py"

set "APPLIO_ROOT=C:\AI\Voices\Applio"
set "APPLIO_PYTHON=C:\AI\Voices\Applio\env\python.exe"
set "APPLIO_UI_BAT=%REPO_ROOT%\scripts\voice\run_applio_ui.bat"

set "ACE_STEP_ROOT_A=C:\AI\ACE-Step-1.5"
set "ACE_STEP_ROOT_B=C:\AI\ACE-Step\ACE-Step-1.5"
set "ACE_STEP_ROOT_C=%USERPROFILE%\ACE-Step-1.5"



call :Banner

if not exist "%REPO_ROOT%" (
  echo [FAIL] Repo root not found:
  echo        %REPO_ROOT%
  goto Done
)

if "%START_COMFY_3090%"=="1" call :StartBat "OTG ComfyUI 3090" 8188 "%COMFY_3090_BAT%"
if "%START_COMFY_5060TI%"=="1" call :StartBat "OTG ComfyUI 5060Ti" 8288 "%COMFY_5060TI_BAT%"
if "%START_WHISPER%"=="1" call :StartBat "OTG Whisper 9001" 9001 "%WHISPER_BAT%"
if "%START_XTTS%"=="1" call :StartBat "OTG XTTS 7862" 7862 "%XTTS_BAT%"
if "%START_QWEN3_API%"=="1" call :StartBat "OTG Qwen3 TTS API 7863" 7863 "%QWEN3_API_BAT%"
if "%START_COSYVOICE%"=="1" call :StartCosyVoice
if "%START_BG_REMOVE%"=="1" call :StartBat "OTG BG Remove 3333" 3333 "%BG_REMOVE_BAT%"

if "%START_ACE_STEP_15_UI%"=="1" call :StartAceStep15UI
if "%START_ACE_STEP_15_API%"=="1" call :StartAceStep15API
if "%START_SEEDVC_UI%"=="1" call :StartBat "OTG Seed-VC UI 7864" 7864 "%SEEDVC_BAT%"
if "%START_QWEN3_UI%"=="1" call :StartBat "OTG Qwen3 TTS UI 8000" 8000 "%QWEN3_UI_BAT%"
if "%START_APPLIO_UI%"=="1" call :StartApplioUI
if not "%START_APPLIO_UI%"=="1" call :PrintApplioDisabled

if "%START_NEXT_TEST%"=="1" call :StartNextTest
if "%START_VOICE_DATASET_WORKER%"=="1" call :StartVoiceDatasetWorker
if "%START_VOICE_APPLIO_WORKER%"=="1" call :StartVoiceApplioWorker
if "%START_CHARACTER_PREVIEW_WORKER%"=="1" call :StartCharacterPreviewWorker

goto Done

:Banner
echo.
echo ============================================================
echo  SLR Studios OTG TEST - Stable Service Launcher v2
echo ============================================================
echo Repo: %REPO_ROOT%
echo.
echo This window should stay open.
echo Child service windows are launched with cmd /k so crashes stay visible.
echo.
exit /b 0

:StartBat
set "SERVICE_TITLE=%~1"
set "SERVICE_PORT=%~2"
set "SERVICE_BAT=%~3"
call :IsPortOpen %SERVICE_PORT%
if "%PORT_OPEN%"=="1" (
  echo [SKIP] %SERVICE_TITLE% already responds on port %SERVICE_PORT%.
  exit /b 0
)
if not exist "%SERVICE_BAT%" (
  echo [WARN] %SERVICE_TITLE% BAT not found:
  echo        %SERVICE_BAT%
  exit /b 0
)
echo [START] %SERVICE_TITLE%
echo         %SERVICE_BAT%
start "%SERVICE_TITLE%" cmd /k ""%SERVICE_BAT%""
timeout /t 2 /nobreak >nul
exit /b 0

:StartNextTest
call :IsPortOpen 3001
if "%PORT_OPEN%"=="1" (
  echo [SKIP] OTG Next TEST already responds on port 3001.
  exit /b 0
)
if not exist "%REPO_ROOT%\package.json" (
  echo [WARN] package.json not found:
  echo        %REPO_ROOT%\package.json
  exit /b 0
)
echo [START] OTG Next TEST app on port 3001
start "OTG Next TEST 3001" cmd /k "cd /d ""%REPO_ROOT%"" && npm run dev -- -p 3001"
timeout /t 2 /nobreak >nul
exit /b 0

:StartVoiceDatasetWorker
if not exist "%VOICE_DATASET_WORKER_PS1%" (
  echo [WARN] OTG Voice Dataset Worker PS1 not found:
  echo        %VOICE_DATASET_WORKER_PS1%
  exit /b 0
)
tasklist /v /fi "imagename eq cmd.exe" | findstr /i /c:"OTG Voice Dataset Worker" >nul 2>nul
if not errorlevel 1 (
  echo [SKIP] OTG Voice Dataset Worker already appears to be running.
  exit /b 0
)
echo [START] OTG Voice Dataset Worker
echo         %VOICE_DATASET_WORKER_PS1%
start "OTG Voice Dataset Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_DATASET_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-dataset-worker"
timeout /t 2 /nobreak >nul
exit /b 0

:StartVoiceApplioWorker
if not exist "%VOICE_APPLIO_WORKER_PS1%" (
  echo [WARN] OTG Voice Applio Worker PS1 not found:
  echo        %VOICE_APPLIO_WORKER_PS1%
  exit /b 0
)
tasklist /v /fi "imagename eq cmd.exe" | findstr /i /c:"OTG Voice Applio Worker" >nul 2>nul
if not errorlevel 1 (
  echo [SKIP] OTG Voice Applio Worker already appears to be running.
  exit /b 0
)
echo [START] OTG Voice Applio Worker
echo         %VOICE_APPLIO_WORKER_PS1%
start "OTG Voice Applio Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%VOICE_APPLIO_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-voice-applio-worker"
timeout /t 2 /nobreak >nul
exit /b 0

:StartCharacterPreviewWorker
if not exist "%CHARACTER_PREVIEW_WORKER_PS1%" (
  echo [WARN] OTG Character Preview Worker PS1 not found:
  echo        %CHARACTER_PREVIEW_WORKER_PS1%
  exit /b 0
)
tasklist /v /fi "imagename eq cmd.exe" | findstr /i /c:"OTG Character Preview Worker" >nul 2>nul
if not errorlevel 1 (
  echo [SKIP] OTG Character Preview Worker already appears to be running.
  exit /b 0
)
echo [START] OTG Character Preview Worker
echo         %CHARACTER_PREVIEW_WORKER_PS1%
start "OTG Character Preview Worker" cmd /k "cd /d ""%REPO_ROOT%"" && powershell -NoProfile -ExecutionPolicy Bypass -File ""%CHARACTER_PREVIEW_WORKER_PS1%"" -BaseUrl http://127.0.0.1:3001 -WorkerId windows-character-preview-worker"
timeout /t 2 /nobreak >nul
exit /b 0

:StartCosyVoice
if exist "%COSYVOICE_BAT%" (
  echo [START] OTG CosyVoice
  echo         %COSYVOICE_BAT%
  start "OTG CosyVoice" cmd /k ""%COSYVOICE_BAT%""
  timeout /t 2 /nobreak >nul
  exit /b 0
)
echo [INFO] No long-running CosyVoice BAT found:
echo        %COSYVOICE_BAT%
if not exist "%COSYVOICE_ROOT%" (
  echo [WARN] CosyVoice root not found:
  echo        %COSYVOICE_ROOT%
  exit /b 0
)
if not exist "%COSYVOICE_PYTHON%" (
  echo [WARN] CosyVoice Python not found:
  echo        %COSYVOICE_PYTHON%
  exit /b 0
)
if not exist "%COSYVOICE_BRIDGE%" (
  echo [WARN] CosyVoice bridge not found:
  echo        %COSYVOICE_BRIDGE%
  exit /b 0
)
echo [OK] CosyVoice worker path appears available.
echo      Root:   %COSYVOICE_ROOT%
echo      Python: %COSYVOICE_PYTHON%
echo      Bridge: %COSYVOICE_BRIDGE%
echo [INFO] OTG can use CosyVoice per create_voice_sample worker job.
exit /b 0

:StartApplioUI
if exist "%APPLIO_UI_BAT%" (
  echo [START] OTG Applio UI/helper
  echo         %APPLIO_UI_BAT%
  start "OTG Applio UI" cmd /k ""%APPLIO_UI_BAT%""
  timeout /t 2 /nobreak >nul
  exit /b 0
)
echo [INFO] Applio UI BAT not found:
echo        %APPLIO_UI_BAT%
exit /b 0

:PrintApplioDisabled
echo [INFO] Applio UI/helper disabled by default: START_APPLIO_UI=0
echo        CosyVoice may be worker-backed.
echo        OTG Applio training is handled by the dedicated Windows Voice Applio Worker, not START_APPLIO_UI.
exit /b 0

:StartHunyuan3D
call :IsPortOpen 8080
if "%PORT_OPEN%"=="1" (
  echo [SKIP] Hunyuan3D already responds on port 8080.
  exit /b 0
)
if "%HUNYUAN_ROOT%"=="" if exist "%HUNYUAN_ROOT_B%\gradio_app.py" if exist "%HUNYUAN_PY_B%" (
  set "HUNYUAN_ROOT=%HUNYUAN_ROOT_B%"
  set "HUNYUAN_PY=%HUNYUAN_PY_B%"
)
if "%HUNYUAN_ROOT%"=="" (
  echo [WARN] Hunyuan3D root/Python not found.
  echo        Tried:
  echo        %HUNYUAN_ROOT_A%
  echo        %HUNYUAN_ROOT_B%
  exit /b 0
)
echo [START] Hunyuan3D on port 8080
echo         Root: %HUNYUAN_ROOT%
echo         Python: %HUNYUAN_PY%
start "OTG Hunyuan3D 8080" cmd /k "cd /d ""%HUNYUAN_ROOT%"" && ""%HUNYUAN_PY%"" -s gradio_app.py --mini --enable_t23d --profile 5 --turbo"
timeout /t 2 /nobreak >nul
exit /b 0

:ResolveAceStep15
set "ACE_STEP_ROOT="
for %%D in ("%ACE_STEP_ROOT_A%" "%ACE_STEP_ROOT_B%" "%ACE_STEP_ROOT_C%") do (
  if "%ACE_STEP_ROOT%"=="" (
    if exist "%%~D\pyproject.toml" set "ACE_STEP_ROOT=%%~D"
  )
)
exit /b 0

:StartAceStep15UI
call :IsPortOpen 7860
if "%PORT_OPEN%"=="1" (
  echo [SKIP] ACE-Step 1.5 UI already responds on port 7860.
  exit /b 0
)
call :ResolveAceStep15
if "%ACE_STEP_ROOT%"=="" (
  echo [WARN] ACE-Step 1.5 root not found.
  exit /b 0
)
echo [START] ACE-Step 1.5 UI on port 7860
echo         Root: %ACE_STEP_ROOT%
if exist "%ACE_STEP_ROOT%\start_gradio_ui.bat" (
  start "OTG ACE-Step 1.5 UI 7860" cmd /k "cd /d ""%ACE_STEP_ROOT%"" && set PORT=7860 && call start_gradio_ui.bat"
) else (
  where uv >nul 2>nul
  if errorlevel 1 (
    echo [WARN] uv was not found on PATH. Cannot start ACE-Step 1.5 UI.
    exit /b 0
  )
  start "OTG ACE-Step 1.5 UI 7860" cmd /k "cd /d ""%ACE_STEP_ROOT%"" && set PORT=7860 && uv run acestep"
)
timeout /t 2 /nobreak >nul
exit /b 0

:StartAceStep15API
call :IsPortOpen 8001
if "%PORT_OPEN%"=="1" (
  echo [SKIP] ACE-Step 1.5 API already responds on port 8001.
  exit /b 0
)
call :ResolveAceStep15
if "%ACE_STEP_ROOT%"=="" (
  echo [WARN] ACE-Step 1.5 root not found.
  exit /b 0
)
echo [START] ACE-Step 1.5 API on port 8001
echo         Root: %ACE_STEP_ROOT%
if exist "%ACE_STEP_ROOT%\start_api_server.bat" (
  start "OTG ACE-Step 1.5 API 8001" cmd /k "cd /d ""%ACE_STEP_ROOT%"" && set PORT=8001 && call start_api_server.bat"
) else (
  where uv >nul 2>nul
  if errorlevel 1 (
    echo [WARN] uv was not found on PATH. Cannot start ACE-Step 1.5 API.
    exit /b 0
  )
  start "OTG ACE-Step 1.5 API 8001" cmd /k "cd /d ""%ACE_STEP_ROOT%"" && set PORT=8001 && uv run acestep-api"
)
timeout /t 2 /nobreak >nul
exit /b 0

:IsPortOpen
set "PORT_OPEN=0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%~1; $c=New-Object Net.Sockets.TcpClient; try { $iar=$c.BeginConnect('127.0.0.1',$p,$null,$null); if(-not $iar.AsyncWaitHandle.WaitOne(300)){ exit 1 }; $c.EndConnect($iar); $c.Close(); exit 0 } catch { try { $c.Close() } catch {}; exit 1 }" >nul 2>nul
if not errorlevel 1 set "PORT_OPEN=1"
exit /b 0

:Done
echo.
echo ============================================================
echo  Startup requests complete.
echo ============================================================
echo.
echo Expected local endpoints:
echo   Next TEST app:       http://127.0.0.1:3001/app
echo   ComfyUI 3090:        http://127.0.0.1:8188
echo   ComfyUI 5060Ti:      http://127.0.0.1:8288
echo   Whisper:             http://127.0.0.1:9001/health
echo   XTTS:                http://127.0.0.1:7862/health
echo   Qwen3 TTS API:       http://127.0.0.1:7863/health
echo   BG Remove:           http://127.0.0.1:3333
echo   Hunyuan3D:           http://127.0.0.1:8080
echo   ACE-Step 1.5 UI:     http://127.0.0.1:7860
echo   ACE-Step 1.5 API:    http://127.0.0.1:8001
echo   Voice Dataset Worker: background PowerShell worker, no HTTP endpoint
echo   Voice Applio Worker:  background PowerShell worker, no HTTP endpoint
echo   Character Preview Worker: background PowerShell worker, no HTTP endpoint
echo.
echo Notes:
echo   CosyVoice may be worker-backed.
echo   Applio UI remains disabled by default.
echo   OTG Applio training is handled by the dedicated Windows Voice Applio Worker, not by START_APPLIO_UI.
echo   Character Preview Dub requires OTG_CHARACTER_PREVIEW_ADAPTER on the Windows worker.
echo.
echo If a child service failed, check its separate window.
echo Leave this launcher window open while testing.
echo.
pause
exit /b 0
