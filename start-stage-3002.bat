@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0start-stage-3002.ps1"
pause