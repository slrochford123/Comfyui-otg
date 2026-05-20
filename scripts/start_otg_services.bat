@echo off
setlocal EnableExtensions

REM ============================================================
REM SLR Studios OTG TEST - Start Web App Services
REM Repo: C:\AI\OTG-Test2
REM Purpose: start the services used by the TEST web app in separate windows.
REM ============================================================

set "REPO_ROOT=C:\AI\OTG-Test2"

REM Core services
set "START_COMFY_3090=1"
set "START_COMFY_5060TI=1"
set "START_WHISPER=1"
set "START_XTTS=1"
set "START_QWEN3_API=1"
set "START_BG_REMOVE=1"
set "START_NEXT_TEST=1"

REM Heavy / optional services
REM Hunyuan3D is needed for Angles / 3D model features, but it is GPU-heavy.
set "START_HUNYUAN3D=1"

REM ACE-Step 1.5 is a local music generation service.
REM UI runs on port 7860 by default.
REM API runs on port 8001 by default.
set "START_ACE_STEP_15=1"
set "START_ACE_STEP_15_API=0"

REM Not required by OTG for normal conversion. OTG calls Seed-VC per job.
REM Turn this on only if you want the manual Seed-VC UI open.
set "START_SEEDVC_UI=0"

REM Qwen3 UI is not required by OTG. OTG uses the Qwen3 FastAPI service.
set "START_QWEN3_UI=0"

REM Paths
set "COMFY_3090_BAT=C:\AI\Comfyui\ComfyUI - 3090.bat"
set "COMFY_5060TI_BAT=C:\AI\Comfyui\ComfyUI - 5060ti.bat"
set "WHISPER_BAT=C:\AI\Services\whisper\run_whisper_server.bat"
set "XTTS_BAT=%REPO_ROOT%\scripts\voice\run_xtts_server.bat"
set "QWEN3_API_BAT=%REPO_ROOT%\scripts\voice\run_qwen3_tts_api.bat"
set "QWEN3_UI_BAT=%REPO_ROOT%\scripts\voice\run_qwen3_tts_ui.bat"
set "SEEDVC_BAT=%REPO_ROOT%\scripts\voice\run_seedvc.bat"
set "BG_REMOVE_BAT=%REPO_ROOT%\services\bg_remove\run_bg_remove.bat"

REM ACE-Step 1.5 path fallbacks.
set "ACE_STEP_ROOT_A=C:\AI\ACE-Step-1.5"
set "ACE_STEP_ROOT_B=C:\AI\ACE-Step\ACE-Step-1.5"
set "ACE_STEP_ROOT_C=%USERPROFILE%\ACE-Step-1.5"

REM Hunyuan3D path fallback A.
set "HUNYUAN_ROOT_A=C:\AI\Hunyuan3D\Hunyuan3D-2"
set "HUNYUAN_PY_A=C:\AI\Hunyuan3D\python_standalone\python.exe"

REM Hunyuan3D path fallback B.
set "HUNYUAN_ROOT_B=C:\AI\Hunyuan3D-2"
set "HUNYUAN_PY_B=C:\Users\SLRoc\miniconda3\envs\hy3d_clean\python.exe"

echo.
echo ============================================================
echo  SLR Studios OTG TEST - Starting Services
echo ============================================================
echo Repo: %REPO_ROOT%
echo.

if "%START_COMFY_3090%"=="1" call :StartBat "OTG ComfyUI 3090" 8188 "%COMFY_3090_BAT%"
if "%START_COMFY_5060TI%"=="1" call :StartBat "OTG ComfyUI 5060Ti" 8288 "%COMFY_5060TI_BAT%"
if "%START_WHISPER%"=="1" call :StartBat "OTG Whisper 9001" 9001 "%WHISPER_BAT%"
if "%START_XTTS%"=="1" call :StartBat "OTG XTTS 7862" 7862 "%XTTS_BAT%"
if "%START_QWEN3_API%"=="1" call :StartBat "OTG Qwen3 TTS API 7863" 7863 "%QWEN3_API_BAT%"
if "%START_BG_REMOVE%"=="1" call :StartBat "OTG BG Remove 3333" 3333 "%BG_REMOVE_BAT%"

if "%START_HUNYUAN3D%"=="1" call :StartHunyuan3D
if "%START_ACE_STEP_15%"=="1" call :StartAceStep15UI
if "%START_ACE_STEP_15_API%"=="1" call :StartAceStep15API

if "%START_SEEDVC_UI%"=="1" call :StartBat "OTG Seed-VC UI 7864" 7864 "%SEEDVC_BAT%"
if "%START_QWEN3_UI%"=="1" call :StartBat "OTG Qwen3 TTS UI 8000" 8000 "%QWEN3_UI_BAT%"

if "%START_NEXT_TEST%"=="1" call :StartNextTest

echo.
echo ============================================================
echo  Startup requests sent.
echo ============================================================
echo.
echo Check the opened windows for model download, CUDA, or dependency errors.
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
echo.
echo ACE-Step note:
echo   ACE-Step 1.5 UI is enabled by default: START_ACE_STEP_15=1
echo   ACE-Step 1.5 API is disabled by default: START_ACE_STEP_15_API=0
echo   Expected install path fallback A: %ACE_STEP_ROOT_A%
echo.
echo Seed-VC note:
echo   Seed-VC is normally called by OTG per conversion job.
echo   Its manual UI is disabled by default: START_SEEDVC_UI=0
echo.
pause
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
  echo [WARN] package.json not found in %REPO_ROOT%
  exit /b 0
)

echo [START] OTG Next TEST app on port 3001
start "OTG Next TEST 3001" cmd /k "cd /d %REPO_ROOT% && npm run dev -- -p 3001"
timeout /t 2 /nobreak >nul
exit /b 0


:StartHunyuan3D
call :IsPortOpen 8080
if "%PORT_OPEN%"=="1" (
  echo [SKIP] Hunyuan3D already responds on port 8080.
  exit /b 0
)

set "HUNYUAN_ROOT="
set "HUNYUAN_PY="

if exist "%HUNYUAN_ROOT_A%\gradio_app.py" (
  if exist "%HUNYUAN_PY_A%" (
    set "HUNYUAN_ROOT=%HUNYUAN_ROOT_A%"
    set "HUNYUAN_PY=%HUNYUAN_PY_A%"
  )
)

if "%HUNYUAN_ROOT%"=="" (
  if exist "%HUNYUAN_ROOT_B%\gradio_app.py" (
    if exist "%HUNYUAN_PY_B%" (
      set "HUNYUAN_ROOT=%HUNYUAN_ROOT_B%"
      set "HUNYUAN_PY=%HUNYUAN_PY_B%"
    )
  )
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
  echo        Tried:
  echo        %ACE_STEP_ROOT_A%
  echo        %ACE_STEP_ROOT_B%
  echo        %ACE_STEP_ROOT_C%
  echo.
  echo        Install expected:
  echo        git clone https://github.com/ACE-Step/ACE-Step-1.5.git C:\AI\ACE-Step-1.5
  echo        cd /d C:\AI\ACE-Step-1.5
  echo        uv sync
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
    echo        Install uv or use ACE-Step's portable package.
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
  echo        Tried:
  echo        %ACE_STEP_ROOT_A%
  echo        %ACE_STEP_ROOT_B%
  echo        %ACE_STEP_ROOT_C%
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
    echo        Install uv or use ACE-Step's portable package.
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
