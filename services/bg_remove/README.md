# OTG Background Removal Service (Python)

This service provides local background removal for Storyboard character images.

## Endpoint

- `POST http://127.0.0.1:3333/remove-bg`
  - multipart form field: `image`
  - returns: `image/png` (transparent background)

## Setup (Windows)

From repo root:

```powershell
cd services\bg_remove
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## Run

```powershell
cd services\bg_remove
.\.venv\Scripts\Activate.ps1
python -m uvicorn app:app --host 127.0.0.1 --port 3333
```

First run will download the default rembg model (U2Net) into your user cache.

## OTG App Config

In `.env.local` (OTG root):

```ini
BG_REMOVE_URL=http://127.0.0.1:3333/remove-bg
BG_REMOVE_TIMEOUT_MS=60000
```
