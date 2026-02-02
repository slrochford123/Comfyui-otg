# OTG Roadmap (Official Order)

This file is the single source of truth for the feature implementation order.

## Phase A — Lock UI parity
**Goal:** dev UI == production UI.

**Done when:**
- Storybook runs from this repo (`npm run storybook`) and uses the same global styles as prod (`app/globals.css`).
- At least the core UI surfaces have stories (minimum: `HeaderBar`, `QueuePanel`).
- `npm run build` succeeds and `npm run start` matches `npm run dev` for the same route.

## Phase B — Stabilize auth + routing
**Goal:** `/login → /app` is reliable across refreshes/devices and auth has a single source of truth.

**Done when:**
- Middleware gates `/app` (unauth) and `/login` (already authed) based on the configured auth cookie name.
- The UI checks auth via **one** endpoint: `/api/whoami`.
- Invalid/stale cookies are handled cleanly (logout + redirect to `/login?reason=session`).
- Client routing does not flicker between `/login` and `/app`.

## Phase C — ComfyUI integration + real progress
**Goal:** send real jobs to ComfyUI and show true realtime progress (not a fake spinner).

**Done when:**
- `/api/comfy` can submit a workflow (by preset id or raw prompt graph) to ComfyUI successfully.
- The UI shows realtime % based on ComfyUI events (`progress.value/max`) and updates node name while executing.
- Realtime events work both local and remote by using the server-side proxy (`/api/comfy-events`) instead of direct browser websockets.
- Completion is detected reliably via `/api/progress` (history lookup for the newest `prompt_id` for this device).
- On completion, the app auto-runs `/api/gallery/sync` and the new output appears in Gallery.

## Phase D — Queue + History
**Done when:** multi-job queue works and history persists (SQLite) per user.

## Phase E — Gallery (ownership + filters + download/share)
**Done when:** outputs are owned per user/device, filterable, and downloadable.

## Phase F — Monetization tiers/permissions → Stripe
**Done when:** tiers gate features server-side and Stripe checkout/webhooks update entitlements.

## Phase G — PWA installable → Capacitor Android APK
**Done when:** app is installable (PWA) and a stable Android APK exists via Capacitor.
