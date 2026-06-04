@echo off
setlocal

cd /d %~dp0

if not exist .venv (
  py -3.11 -m venv .venv
)

call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

python -m uvicorn app:app --host 0.0.0.0 --port 3333

endlocal
