# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

OTG (On The Go) is a Next.js 15 web application that provides a browser-based UI for generating images and videos via ComfyUI backends. It supports user authentication, per-user/device galleries, storyboard workflows, voice cloning/TTS, and an admin panel. It also ships as an Android app via Capacitor.

## Build & Development Commands

```
npm run dev          # Start Next.js dev server (port 3000)
npm run build        # Production build (outputs standalone artifact under .next/standalone)
npm run start        # Start production server
npm run lint         # Run ESLint
```

Node version: `>=20.11.0 <21` (see `.nvmrc` for exact: 20.11.1)

### Running Tests

Tests use Vitest with jsdom environment. Config is at `tests/vitest.config.ts`, setup at `tests/setup.ts`.

```
npx vitest                      # Run all tests
npx vitest run tests/unit/HeaderBar.test.tsx   # Run a single test file
```

Test files live in `tests/unit/`. The setup stubs `next/image`, `next/link`, and `next/navigation` for component tests outside the Next.js runtime.

### Production Deployment

PM2 config in `ecosystem.config.cjs` defines `otg-prod` (port 3000) and `otg-test` (port 3001). The app uses Cloudflare Tunnel for external access (config in `.cloudflared/`).

## Architecture

### Next.js App Router Structure

The app uses the Next.js App Router (`app/` directory). Key routing:

- `/` — redirects to `/app` (client-side)
- `/login`, `/signup`, `/forgot-password` — public auth pages
- `/app` — authenticated app shell (gated by middleware)
- `/app/app/` — inner app with tabbed UI (`AppPageClient.tsx` is the main client component)
- `/storyboard`, `/voices`, `/angles` — dedicated feature pages
- `/admin` — admin panel (gallery, users, feedback management)
- `/api/` — ~60+ API route handlers

### Middleware & Auth

`middleware.ts` enforces session gating: redirects unauthenticated users from `/app` to `/login` and authenticated users from `/login` to `/app`. Session cookies are checked by name from `AUTH_COOKIE_NAME` env var (default: `otg_session`).

Auth is JWT-based (HS256 via `jose`) with a local SQLite database (`data/otg.db`) managed by `better-sqlite3`. Key auth files:
- `lib/auth/jwt.ts` — sign/verify sessions, enforces single active session per user
- `lib/auth/db.ts` — SQLite singleton, migration system (schema_migrations table)
- `lib/auth/cookies.ts` — cookie name helper
- `lib/auth/admin.ts` — admin email allowlist
- `lib/sessionUser.ts` — `requireSessionUser()` / `getSessionUser()` for API routes
- `lib/ownerKey.ts` — `getOwnerContext()` resolves the owner (user or device) from request

### Owner Model (ownerKey)

Content is scoped by "owner". If a user is logged in, `ownerKey = username`; otherwise, `ownerKey = deviceId`. This determines gallery directories, content state, favorites, etc. The `OwnerContext` type in `lib/ownerKey.ts` and `SessionUser` in `lib/sessionUser.ts` carry this through API routes.

Device ID is read from headers (`x-otg-device-id`), query params, or request body via `lib/otgDevice.ts`.

### Data & File Layout

All persistent data lives under `OTG_DATA_DIR` (env var, defaults to `<repo>/data`). Key subdirectories:
- `device_galleries/` — media files per device
- `user_galleries/` — media files per user
- `device_inbox/`, `user_inbox/` — incoming files
- `device_favorites/`, `user_favorites/` — favorited files
- `content_state/` — per-owner JSON state files tracking generation status
- `device_jobs/` — job tracking (JSONL per device)
- `otg.db` — SQLite database for auth/users/jobs/artifacts

Path helpers are centralized in `lib/paths.ts` (includes `ensureDir`, `safeJoin`, `safeDeviceId`, `getOwnerDirs`).

### ComfyUI Integration

- `COMFY_BASE_URL` env var points to the ComfyUI backend (default: `http://127.0.0.1:8188`)
- Admins can switch between multiple GPU targets via `config/comfy_targets.json` (or `OTG_COMFY_TARGETS_FILE` env)
- `app/api/_lib/comfyTarget.ts` — resolves which ComfyUI backend to use
- `app/api/comfy/route.ts` — main generation endpoint; loads workflow JSON, injects prompts into graph nodes, submits to ComfyUI
- `lib/workflows.ts` — workflow discovery, validation, prompt graph extraction. Workflows are JSON files in `comfy_workflows/` (presets, storyboard, internal)

### Workflow System

Workflow JSON files live in `comfy_workflows/`. The system:
1. Reads `comfy_workflows/index.json` if present, otherwise auto-discovers `.json` files
2. Validates prompt graph format vs UI workflow format (`detectWorkflowFormat`)
3. Extracts prompt graph, injects user prompts via `setTextEncodes()` heuristics
4. Supports `__otg` metadata key in workflow JSON for explicit node mapping
5. `__OTG_INPUT_IMAGE__` placeholder in workflow JSON indicates img2img slots

Categories: `presets/` (user-facing), `storyboard/` (storyboard tab), `internal/` (helper workflows hidden from Generate dropdown).

### Content State Machine

`lib/contentState.ts` tracks per-owner generation state: `idle` → `running` → `done`/`error`. State is persisted as JSON files under `data/content_state/`. This drives the UI polling for generation progress.

### Gallery System

Gallery routes under `app/api/gallery/` handle listing, file serving, metadata, uploads, downloads. Gallery metadata (`.meta.json` sidecar files) stores prompts and retry payloads alongside media files. `lib/galleryFs.ts` provides filesystem-level media listing.

### Storyboard

Multi-scene batch generation with character descriptors. `lib/storyboard/` contains types and ComfyUI workflow manipulation. API routes at `app/api/storyboard/`. Uses Ollama for LLM-based scene planning (`lib/storyboard/ollama.ts`).

### Voices / TTS

Voice cloning, TTS generation, and emotion control. API routes at `app/api/voices/`. Voice studio design endpoint at `app/api/voices/studio/`.

### Background Removal Service

A separate Python microservice in `services/bg_remove/` (FastAPI). Started independently, configured via `BG_REMOVE_URL` env var.

### Path Alias

`@/*` maps to the repository root (configured in `tsconfig.json` and `tests/vitest.config.ts`). Use `@/lib/...`, `@/app/...`, `@/components/...` for imports.

## Key Environment Variables

See `.env.example` for the full list. The most critical:
- `COMFY_BASE_URL` — ComfyUI server URL
- `OTG_DATA_DIR` — root for all persistent data
- `OTG_JWT_SECRET` / `AUTH_SECRET` — JWT signing key
- `AUTH_COOKIE_NAME` — session cookie name (default `otg_session`)
- `ADMIN_IDENTIFIERS` — comma-separated admin emails/usernames
- `OLLAMA_BASE_URL`, `OLLAMA_VISION_MODEL` — local LLM for storyboard/vision
- `FFMPEG_PATH` — path to ffmpeg binary (used for video transcoding)

## Conventions

- API route handlers use `export const runtime = "nodejs"` and typically `export const dynamic = "force-dynamic"`.
- API routes that need auth should use `requireSessionUser(req)` or `getSessionUser(req)` from `lib/sessionUser.ts`. Catch `SessionInvalidError` and return 401.
- Env loading fallback logic is in `lib/env.ts` — fills missing env vars from `.env.local` / `.env` when `OTG_DATA_DIR` is not set.
- SQLite migrations are defined in `lib/auth/db.ts` as an array and applied automatically on first DB access via `ensureMigrations()`.
- Many `.bak` files exist alongside source files — these are manual backups and should not be modified or committed.
