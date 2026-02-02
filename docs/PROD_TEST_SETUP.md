# SLR Studios OTG: Production + Test Site (Recommended Setup)

This setup runs **two separate OTG web apps** and **two separate ComfyUI instances**, pinned to different GPUs.

## Ports
- **OTG Production**: http://127.0.0.1:3000 (Cloudflare)
- **OTG Test**: http://127.0.0.1:3001 (Tailscale-only)
- **ComfyUI Production (RTX 3090 / GPU 0)**: http://127.0.0.1:8188
- **ComfyUI Test (RTX 5060 Ti / GPU 1)**: http://127.0.0.1:8288

## Folders
- Production repo: `C:\Users\SLRoc\comfy-controller`
- Test repo: `C:\Users\SLRoc\comfy-controller-test`

## Environment isolation (critical)
Production `.env.local` should keep using:
- `OTG_DATA_DIR=C:/Users/SLRoc/comfy-controller-prod`
- `COMFY_BASE_URL=http://127.0.0.1:8188`
- `AUTH_COOKIE_NAME=otg_session`

Test `.env.local` should use:
- `OTG_DATA_DIR=C:/Users/SLRoc/comfy-controller-test-data`
- `COMFY_BASE_URL=http://127.0.0.1:8288`
- `AUTH_COOKIE_NAME=otg_session_test`
- `OTG_ALLOW_ANY_USER=true`
- `ADMIN_IDENTIFIERS=SLRROCHFRD123,SLRochford123`
- `ADMIN_EMAILS=SLRROCHFRD123@protonmail.com,SLRochford123@protonmail.com`

## PM2
Use `ecosystem.dual.config.cjs` to run both apps.
