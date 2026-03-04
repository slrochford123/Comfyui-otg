Storyboard -> Gallery fix (TEST)

What this patch does:
- StoryboardPanel now sends x-otg-device-id on all Storyboard-related API calls.
- /api/storyboard/create now:
  - uses getOwnerContext() to get deviceId/ownerKey
  - markRunning(ownerKey, ...) so /api/gallery/sync will promote outputs
  - appends a JSONL job record with prompt_id to data/device_jobs/<deviceId>.jsonl
- /api/storyboard/batch-generate also logs prompt_id (final output will be promotable)
- /api/device-jobs/log now writes prompt_id (compat with /api/gallery/sync readers)

How to apply:
1) Unzip into your TEST repo root (port 3001) and allow overwrite.
2) Restart TEST Next.js server (pm2 restart otg-test or stop/start).
3) Run a Storyboard generation.
4) Open Gallery tab. It should now pull the finished ComfyUI output into OTG gallery.

Quick verification:
- After clicking Create in Storyboard tab, check data/content_state/<ownerKey>.json is status=running.
- Check data/device_jobs/<deviceId>.jsonl contains a line with prompt_id.
- Then open Gallery; it triggers /api/gallery/sync and should store the output in:
  - data/user_galleries/<username>/ (if logged in)
  - or data/device_galleries/<deviceId>/ (if anonymous)
