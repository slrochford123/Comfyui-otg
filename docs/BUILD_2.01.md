# SLR Studios — Build 2.01

Owner-facing build number: **2.01**. The Settings footer and append-only build history expose this identifier. Package semver and the existing immutable `v2.0.1` and `build-2` tags are not rewritten. This update uses the repository's `build-2.01` tag convention.

## Changes

- Explicit RTX 3090 / RTX 5060 Ti selection shared by H3 Auto, Manual, Edit Video and existing H3 special modes.
- Selected-target binding through plan validation, input authorization, request identity, scheduling, progress, cancellation, recovery and output handling. Explicitly selected jobs do not silently fall back to another GPU.
- Worker-specific Ref Mods library discovery and stale-response handling.
- TEST-only owner experimental permissions support either GPU. TEST installation integrity checks remain separate from physical qualification; no qualification evidence is fabricated or imported into PROD.
- Existing SLA + matching 8-step Turbo behavior and source-video trimming/orientation are preserved.

This release does not replace the existing Ref2VA Turbo adapter with an untested newer version, add a DLSS upscaler, run paid planning calls or claim fresh GPU/video-quality certification.

## Promotion safety

Deploy the exact published commit as a new additive release. Preserve existing PROD environment, secrets, persistent databases, media and authentication sessions. Do not copy TEST users, assets, permissions or qualification records. Take fresh protected-configuration and database backups immediately before switching, verify Node22 and effective systemd precedence, and automatically roll back the application pointer/service on failure without restoring stale databases.

Build 2 remains available for rollback. Any schema migration must be rehearsed against fresh database copies and preserve every original row before applying to live data.
