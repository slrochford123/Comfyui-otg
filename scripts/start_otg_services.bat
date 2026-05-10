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


:IsPortOpen
set "PORT_OPEN=0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%~1; $c=New-Object Net.Sockets.TcpClient; try { $iar=$c.BeginConnect('127.0.0.1',$p,$null,$null); if(-not $iar.AsyncWaitHandle.WaitOne(300)){ exit 1 }; $c.EndConnect($iar); $c.Close(); exit 0 } catch { try { $c.Close() } catch {}; exit 1 }" >nul 2>nul
if not errorlevel 1 set "PORT_OPEN=1"
exit /b 0
