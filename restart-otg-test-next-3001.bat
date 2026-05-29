@echo off
setlocal EnableExtensions DisableDelayedExpansion

REM ============================================================
REM SLR Studios OTG TEST - Restart Next Dev Server on 3001
REM Repo: C:\AI\OTG-Test2
REM Purpose:
REM   Kill stale Next dev server on port 3001 and restart it so .env.local reloads.
REM ============================================================

set "REPO_ROOT=C:\AI\OTG-Test2"
set "PORT=3001"

echo.
echo ============================================================
echo  Restart OTG TEST Next Dev Server
echo ============================================================
echo Repo: %REPO_ROOT%
echo Port: %PORT%
echo.

if not exist "%REPO_ROOT%\package.json" (
  echo [FAIL] package.json not found:
  echo        %REPO_ROOT%\package.json
  goto Done
)

echo [CHECK] Looking for process using port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo [STOP] Killing PID %%P using port %PORT%
  taskkill /PID %%P /F
)

echo.
echo [CHECK] Required env flags in .env.local:
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$envPath='C:\AI\OTG-Test2\.env.local';" ^
  "if(!(Test-Path $envPath)){Write-Host '[FAIL] Missing .env.local'; exit 1};" ^
  "$t=Get-Content $envPath -Raw;" ^
  "$keys=@('OTG_ENABLE_REAL_QWEN3_VOICE_SAMPLE','OTG_ENABLE_REAL_COSY_VOICE_SAMPLE','OTG_ENABLE_REAL_VOICE_FX','AUTH_SECRET');" ^
  "foreach($k in $keys){ if($t -match ('(?m)^\s*'+[regex]::Escape($k)+'\s*=\s*(.+?)\s*$')){ Write-Host ('[OK]   '+$k+'='+$Matches[1].Trim()) } else { Write-Host ('[MISS] '+$k) } }"

echo.
echo [START] Starting Next TEST app on port %PORT%
echo.

start "OTG Next TEST 3001" cmd /k "cd /d ""%REPO_ROOT%"" && node -v && npm run dev -- -p %PORT%"

timeout /t 3 /nobreak >nul

echo.
echo [INFO] Open:
echo        http://127.0.0.1:%PORT%/app
echo        http://100.76.179.83:%PORT%/app
echo.
echo [IMPORTANT]
echo If node -v in the child window is not v20.x, close it and start from your Node 20 shell.
echo.

:Done
echo.
pause
exit /b 0