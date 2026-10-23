# H3 trim and Admin control-center follow-up

Development is TEST-first. The immutable v2.0.1 commit/tag is unchanged. Do not
promote this work until the TEST build and physical Android acceptance pass.

## Video inputs and limits

- Existing direct multipart 2–10 second `/api/h3/video-edit` requests remain supported.
- The new UI uploads in 8 MiB chunks, then registers an owner/session-scoped source.
- `OTG_H3_VIDEO_SOURCE_MAX_BYTES`: default/hard ceiling 536870912 (512 MiB).
- `OTG_H3_VIDEO_SOURCE_MAX_SECONDS`: default 600; configurable up to 3600.
- Metadata inspection uses ffprobe, not full video decoding. Uploaded containers
  are restricted to MOV/MP4 and Matroska/WebM with file/pipe protocols only.
- `/api/h3/video-edit/source` accepts import/trim actions, never browser paths or
  remote URLs. Start/end must be finite numbers, within the probed source, and
  yield an inclusive 2–10 second selection. The generation boundary re-probes
  the actual chosen file and applies the existing duration contract again.
- Trimming seeks accurately and re-encodes H.264/AAC, maintains orientation and
  source cadence, rounds dimensions down to even pixels, and does not upscale.
- H3 Fun ControlNet, structural conditioning, 3090 routing and final output trim
  are unchanged. Native short-source padding remains in the existing H3 path.

## Private lifecycle

Preview IDs are random UUIDs. Files live below the TEST data root, in hashed-owner
directories with verified session bindings. The browser receives no disk paths.
Preview streaming requires a live matching session and supports byte ranges.
Completed sources/selections expire after two hours, allowing immediate retry.
The UI removes them on source removal/navigation; a minute janitor removes expired
managed directories while the application is running. Expired files are denied
even before cleanup. Registration also performs expiry cleanup after restarts.

Generation receives a separate private copy. New-flow job copies are removed at
confirmed completion/cancellation/failure; Retry creates a new job from the
retained selection. Expired selections must be chosen again. Legacy generation
inputs and existing user/Gallery media are not swept by this cleanup.

Upload cancellation creates an owner-scoped tombstone so an in-flight chunk cannot
resurrect the upload. Trim cancellation targets only its own FFmpeg child and
waits for the private work directory to clear. It never resets or interrupts a GPU.
H3 cancellation retains the established backend-confirmed Safe Cancel path.

## Admin behavior

- Both canonical and legacy Admin pages retain server-side authorization.
- The landing page has one card navigation pattern and a read-only status summary.
- Maintenance cards use explicit 3090/5060ti targets and the existing authenticated,
  identity-pinned agents. Confirmations, busy refusal and duplicate guards remain.
- Health excludes disabled/unconfigured optional services from enabled-service
  totals. Required failures are reported separately. HTTP health does not claim
  model initialization. A configured local IndexTTS interpreter is marked degraded
  until synthesis readiness is separately verified.
- `OTG_SERVICE_<ID>_ENABLED=false` explicitly disables a health target; ID uses
  uppercase letters and underscores (for example `OTG_SERVICE_HUNYUAN_ENABLED`).
- Users show supported identity, derived access role, registration state and last
  recorded sign-in metadata. No unsupported role/disable backend is invented.
- Gallery search/type/sort execute before pagination. Browser pages contain at most
  100 entries (UI uses 48). New gallery-agent query protocol 2 supports complete
  libraries and offset paging; legacy agents can be used only when their full
  metadata listing is available. An incomplete legacy listing fails explicitly
  for queries that cannot be answered correctly. Agent upgrades are a separate
  deployment action, not an automatic shared PROD worker modification.
- Cached image/video thumbnails are reused. Completed file responses are private
  and briefly cacheable; live lists/status remain no-store.
- Local credit records never purchase credits or establish an official account
  balance. Official OpenAI sync without configuration is a small Not configured
  state, not a raw environment error. Billing columns stack below 800px.

## Verification and acceptance

Supported CI: Node 22.23.4, `npm test` (single fork, as defined in vitest.config.ts),
`npx tsc --noEmit --incremental false`, `npm run build`, `git diff --check`.
Build-only environments need a disposable process-local AUTH_SECRET, never a copy
of TEST/PROD credentials. Python suites are under scripts/maintenance,
scripts/test-maintenance, scripts/deploy, and scripts/linux/admin-gallery-agent.

Physical acceptance must use the activated TEST release, not this source checkout:

1. Thirty-second distinguishable source, middle five-second selection; verify the
   trimmed preview, real H3 edit, five-second output, Gallery and download.
2. Two- and ten-second selections; validate duration and playback.
3. Cancel upload/trim/generation; confirm terminal state and successful retry.
4. Verify direct short-source full-video mode and existing H3 I2V/Gallery boundaries.
5. All Admin pages at 390x844 and desktop; light/dark, dialogs, no horizontal
   overflow, confirmed destructive actions using disposable QA records only.
6. Denied non-admin APIs, both explicit GPU identities, and existing data intact.

PROD remains on its accepted v2.0.1 baseline until owner acceptance and a fresh
guarded follow-up release. Preserve old release and all rollback snapshots.
