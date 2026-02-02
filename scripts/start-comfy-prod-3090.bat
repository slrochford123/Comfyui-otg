@echo off
setlocal
REM ComfyUI Production pinned to RTX 3090 (GPU 0) on port 8188
set CUDA_VISIBLE_DEVICES=0
cd /d C:\AI\Comfyui\ComfyUI_windows_portable
call .\python_embeded\python.exe -s .\ComfyUI\main.py --listen 127.0.0.1 --port 8188
endlocal
