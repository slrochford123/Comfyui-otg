@echo off
setlocal

REM SLR Studios OTG - Seed-VC launcher/checker v14
REM Seed-VC is normally called per job by OTG. This starts the Seed-VC UI for manual testing.

set "SEEDVC_ROOT=C:\AI\Voices\Seed-Vc"
set "SEEDVC_PYTHON=%SEEDVC_ROOT%\.venv\Scripts\python.exe"
set "SEEDVC_PORT=7864"

echo [seed-vc] Root: %SEEDVC_ROOT%
echo [seed-vc] Python: %SEEDVC_PYTHON%

if not exist "%SEEDVC_ROOT%" (
  echo [FAIL] Seed-VC root does not exist: %SEEDVC_ROOT%
  echo Run from OTG repo:
  echo   powershell -ExecutionPolicy Bypass -File .\scripts\voice\install_seedvc_windows.ps1
  pause
  exit /b 1
)

if not exist "%SEEDVC_PYTHON%" (
  echo [FAIL] Seed-VC venv Python not found: %SEEDVC_PYTHON%
  echo Run from OTG repo:
  echo   powershell -ExecutionPolicy Bypass -File .\scripts\voice\install_seedvc_windows.ps1
  pause
  exit /b 1
)

cd /d "%SEEDVC_ROOT%"

echo.
echo [seed-vc] Repairing runtime pins after CUDA torch install...
echo [seed-vc] This fixes the NumPy 2.x / PyTorch compiled-extension warning.
"%SEEDVC_PYTHON%" -m pip install --upgrade --force-reinstall "numpy==1.26.4" "pillow>=8,<12"
if errorlevel 1 (
  echo [FAIL] Failed to pin numpy/pillow.
  pause
  exit /b 1
)

echo.
echo [seed-vc] Verifying Python packages and CUDA...
"%SEEDVC_PYTHON%" -c "import sys, numpy, torch; print('[OK] Python:', sys.executable); print('[OK] NumPy:', numpy.__version__); print('[OK] Torch:', torch.__version__); print('[OK] CUDA available:', torch.cuda.is_available()); print('[OK] CUDA device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
if errorlevel 1 (
  echo [FAIL] Seed-VC Python/CUDA check failed.
  pause
  exit /b 1
)

set "GRADIO_SERVER_NAME=127.0.0.1"
set "GRADIO_SERVER_PORT=%SEEDVC_PORT%"

echo.
echo [seed-vc] Looking for a Seed-VC UI entrypoint...

if exist "app.py" (
  echo [seed-vc] Starting app.py with --enable-v2...
  echo [seed-vc] Open the URL printed by Seed-VC. If no URL is printed, try http://127.0.0.1:%SEEDVC_PORT%
  "%SEEDVC_PYTHON%" app.py --enable-v2
  pause
  exit /b %errorlevel%
)

if exist "webui.py" (
  echo [seed-vc] Starting webui.py...
  "%SEEDVC_PYTHON%" webui.py
  pause
  exit /b %errorlevel%
)

if exist "gradio_app.py" (
  echo [seed-vc] Starting gradio_app.py...
  "%SEEDVC_PYTHON%" gradio_app.py
  pause
  exit /b %errorlevel%
)

echo [WARN] No known Seed-VC UI entrypoint was found.
echo [OK] Seed-VC CLI install appears present if inference.py or inference_v2.py exists.
echo.

if exist "inference.py" (
  echo [OK] Found inference.py
) else (
  echo [WARN] Missing inference.py
)

if exist "inference_v2.py" (
  echo [OK] Found inference_v2.py
) else (
  echo [WARN] Missing inference_v2.py
)

echo.
echo OTG calls Seed-VC per conversion job. It does not require this UI to stay open.
pause
exit /b 0
