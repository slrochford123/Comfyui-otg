# Setup

This project is a Next.js app that talks to a local ComfyUI instance and syncs outputs into a per-device gallery directory.

## Requirements
- Node.js (LTS recommended)
- A running ComfyUI instance (default expected at `COMFY_BASE_URL`)

## Local environment variables
Create `.env.local` (do not commit secrets). Use `.env.example` as a starting point.

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run start
```

## Storybook (Phase A)
```bash
npm run storybook
```

## Tests (Vitest)
Vitest is opt-in and does not run during `npm run build`.

```bash
npm run test
```

### Troubleshooting: “Next.js inferred your workspace root” / multiple lockfiles

If Storybook/Next prints a warning about multiple lockfiles and shows a path **outside** the OTG repo (for example `C:\Users\<you>\package-lock.json`), remove or rename that extra lockfile.

Why: Next/Storybook can mis-detect the workspace root on Windows when there is a parent-directory lockfile, which can lead to Webpack/plugin resolution issues.

## Tools you installed (recommended)
- SQLite (via `better-sqlite3`)
- Postman (API testing)
- Everything Search (Windows file discovery)
- FFmpeg (media utilities)
