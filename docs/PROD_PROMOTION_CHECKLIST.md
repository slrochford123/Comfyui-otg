# PROD Promotion Checklist

This checklist is for a later, explicitly approved PROD promotion. It does not authorize a deployment. Replace every `<discovered-...>` value only with facts collected read-only from the actual PROD host.

## 1. Preflight

- [ ] Confirm the change window, operator, rollback owner, and communication channel.
- [ ] Confirm TEST candidate `/home/shawn-rochford/AI/deploy/otg-test/releases/prod-ready-20260718-231300` is the active TEST symlink target.
- [ ] Confirm `RELEASE_VERIFICATION.json` reports `liveTest.status: passed` after at least 30 seconds of stability.
- [ ] Re-run 247+ Vitest tests, `npx tsc --noEmit`, a clean Node 20.20.2 build, workflow JSON validation, and capability manifest validation from the unchanged source snapshot.
- [ ] Read-only discover and record the actual PROD hostname, service, unit/drop-ins, current symlink, releases directory, launcher, Node executable/version, bind/port, health URL, environment files, data root, public origin, and current release.
- [ ] Confirm the PROD service launcher requires root `server.js` or adapt the package layout through a separately reviewed change.
- [ ] Confirm PROD backend URLs are reachable from the PROD service account.
- [ ] Confirm capability manifest backend IDs, URLs, GPU names, model filenames, node classes, and VRAM rules against the actual PROD backends.
- [ ] Confirm no queued generation or long-running user operation will be interrupted.
- [ ] Confirm `shellcheck` and `bash -n` pass for both promotion scripts.

### Sealed PROD candidate packaging contract

The candidate packager stages an explicit allowlist from a clean checkout:

- standalone `server.js`, standalone `node_modules`, `.next/static`, and `public`;
- runtime `config`, `comfy_workflows`, `workflows`, `scripts`, `app/workflows`, and `app/app/workflows`;
- `.release_id`, source/build metadata, and `RELEASE_MANIFEST.sha256`.

The following are source-only or unsafe for a server release and must be absent:

- `android/`, `.git/`, `data/`, `tests/`, `coverage/`, build caches, patch backups, `.env*`, databases, SQLite files, and backup files;
- source-only `app/`/`lib/` trees outside the explicitly required workflow payload;
- TEST state, local secrets, and any dependency on the source worktree.

Use `ops/build-prod-candidate.sh` from the exact approved clean commit. Never repair a sealed candidate by deleting files in place.

## 2. Backup and rollback preparation

- [ ] Record `readlink -f <discovered-prod-current-link>` as the exact rollback target.
- [ ] Validate the previous release has root `server.js`, `.next/static`, `public`, and standalone `node_modules`.
- [ ] Back up the PROD database and mutable PROD data using the existing PROD backup procedure; do not place backups in a release directory.
- [ ] Record database backup path, size, checksum, timestamp, and restore command.
- [ ] Record the current unit and drop-ins with `systemctl cat <discovered-prod-service>`.
- [ ] Record redacted environment variable names and environment-file checksums without copying secret values into an audit.
- [ ] Verify the rollback command below with the exact previous release path before deployment.

## 3. Deployment

- [ ] Run only from `/home/shawn-rochford/AI/work/OTG-Test2` on the discovered PROD host.
- [ ] Use the explicit `--confirm-prod` flag and every discovered PROD value; do not use the historical `/opt/otg` example unless it matches observed state.
- [ ] Confirm the script creates a new timestamped release and does not modify an existing release.
- [ ] Confirm the package contains the standalone runtime and required runtime assets only.
- [ ] Confirm the package excludes TEST/PROD data, databases, sessions, galleries, histories, outputs, secrets, `.env*`, Android files, tests, audits, and backups.
- [ ] Confirm `PREVIOUS_RELEASE.txt` records the actual prior PROD release.
- [ ] Allow the script to switch the symlink atomically and restart only the discovered PROD service.
- [ ] Do not restart or modify either ComfyUI installation.

Promotion command template:

```bash
cd /home/shawn-rochford/AI/work/OTG-Test2
sudo ./ops/promote-dual-gpu-routing-to-prod.sh --confirm-prod --expected-host <discovered-prod-host> --prod-service <discovered-prod-service> --prod-current-link <discovered-prod-current-link> --prod-releases-dir <discovered-prod-releases-dir> --prod-base-url <discovered-prod-base-url>
```

## 4. Smoke tests

- [ ] PROD service is active and its main PID remains stable for at least 30 seconds.
- [ ] Restart count does not increase.
- [ ] Homepage returns 200 or the expected redirect.
- [ ] Login route renders and authentication redirects remain correct.
- [ ] `/api/comfy-status` returns 200 and identifies the expected GPUs/backends.
- [ ] `/api/workflows` returns 200 and lists the expected installed workflows.
- [ ] Capability manifest versions match.
- [ ] A referenced `/_next/static/...` chunk returns 200; browser console has no missing chunks.
- [ ] Journal contains no startup exception, missing module, manifest parse error, database error, or repeated crash.
- [ ] PROD data root in `/api/debug/paths` or an equivalent admin-safe diagnostic remains the original PROD root, never a TEST or release path.

## 5. Functional tests

- [ ] Wan T2V, I2V, and FFLF show no Generate Duration card.
- [ ] Wan submissions preserve the selected workflow ID and submit five seconds, 121 frames, and 24 FPS.
- [ ] LTX shows the single Generate Duration card with 5, 10, and 15 seconds.
- [ ] Rapid double-clicking Generate produces one request/prompt only.
- [ ] A verified 3090 workflow selects the RTX 3090 with the logged reason.
- [ ] With an approved non-generation fallback probe, a verified 5060 Ti workflow is eligible only after the primary is unavailable.
- [ ] Missing-model, missing-node, insufficient-VRAM, unhealthy, installed-not-tested, and unknown workflows are blocked with a clear reason.
- [ ] No ambiguous submission is retried against the other backend.
- [ ] Do not run expensive video generation unless the change owner separately approves it; use archived matrix evidence otherwise.
- [ ] Login, gallery listing, static media, and a low-cost verified image smoke path work with existing PROD data.

## 6. Rollback criteria

Rollback immediately if any of the following occurs:

- service fails to become or remain active;
- port/listener, homepage, status, workflow, capability, or static-asset checks fail;
- restart loop, startup exception, manifest mismatch, missing chunk, database error, or wrong data root appears;
- authentication or gallery access regresses;
- the wrong backend is selected, an unverified workflow is submitted, or one prompt reaches two backends;
- error rate or latency materially exceeds the pre-promotion baseline.

Rollback command template:

```bash
cd /home/shawn-rochford/AI/work/OTG-Test2
sudo ./ops/rollback-dual-gpu-routing-prod.sh --confirm-prod --previous-release <exact-previous-prod-release> --expected-host <discovered-prod-host> --prod-service <discovered-prod-service> --prod-current-link <discovered-prod-current-link> --prod-releases-dir <discovered-prod-releases-dir> --prod-base-url <discovered-prod-base-url>
```

After rollback, verify the service, homepage, login, `/api/comfy-status`, `/api/workflows`, static chunks, journal, and original data root. Preserve the failed release and logs for analysis; do not delete releases or backups.

## 7. Android wrapper verification

- [ ] Do not copy `android/` into the server release.
- [ ] Verify Capacitor production origin/base URL, allowed navigation, authentication cookies, redirects, and deep links.
- [ ] Verify Android version code/name and signing configuration through the established secret-safe build process.
- [ ] Run Capacitor sync/build separately from server promotion.
- [ ] On a real device, verify login, Generate UI contracts, gallery/static media, background/foreground resume, and stale service-worker/cache behavior.
- [ ] Record whether a mobile release is required; server routing changes alone do not automatically require publishing a new APK/AAB.

## 8. Post-promotion monitoring

- [ ] Watch the PROD journal continuously for the first 15 minutes and sample again at 30 and 60 minutes.
- [ ] Track service restart count, HTTP error rate, response latency, queue depth, and backend health.
- [ ] Review `[comfy-routing]` logs for backend ID, workflow ID, selection reason, and any blocked request.
- [ ] Confirm no prompt ID appears against two backend URLs.
- [ ] Confirm PROD data/database growth occurs only under the existing PROD data root.
- [ ] Record the new release, previous release, smoke results, operator, timestamps, and final decision in the promotion audit.
- [ ] Retain the previous release and backups under the normal retention policy; do not delete them as part of promotion.
