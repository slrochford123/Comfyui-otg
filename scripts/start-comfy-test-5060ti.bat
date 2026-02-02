@echo off
setlocal
REM ComfyUI Test pinned to RTX 5060 Ti (GPU 1) on port 8288
set CUDA_VISIBLE_DEVICES=1
cd /d C:\AI\Comfyui\ComfyUI_windows_portable
call .\python_embeded\python.exe -s .\ComfyUI\main.py --listen 127.0.0.1 --port 8288
endlocal
