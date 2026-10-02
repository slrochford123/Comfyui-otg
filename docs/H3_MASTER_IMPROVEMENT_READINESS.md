# H3 Master Improvement Project — software readiness

Date: 2026-09-16. Scope: TEST/source implementation. No PROD deployment and no H3 inference batch.

## Completed software phases

- Phase 0: architecture, backend, workflow, preset, metadata, and port-8785 audit.
- Phase 1: H3-wide responsive containment for media, text, IDs, flex/grid children, and narrow viewports.
- Phase 2: job-aware canceling/canceled states, prompt-specific cancellation, validated legacy interrupt fallback, and retry/post-processing guards.
- Phase 3: owner/job/prompt/backend-scoped ComfyUI preview relay POC behind `H3_LIVE_PREVIEW_ENABLED=1`.
- Phase 4: canonical registry containing the default, 28 legacy Prompt Builder styles, and 33 newer creative Style Art presets.
- Phase 5: searchable, categorized, mobile bottom-sheet selector shared by H3 Generate and Production Pipeline.
- Phase 6: optional poster/MP4/WebM metadata, selected-only playback, reduced-motion behavior, lazy posters, and missing-media fallback.
- Phase 7: H3 Generate, the existing Prompt Builder path, and Production Pipeline now resolve the same stable canonical style IDs. Camera and shot-flow controls remain independent.
- Phase 8: port-8785 phone-access behavior and security documented; installed service remains loopback-only.
- Phase 9: standardized scene manifest and repeatable one-second preview/poster/WebM encoder/validator implemented and smoke-tested with synthetic footage.
- Phase 11 software checks: type checking, full automated suite, production build, and compiled-runtime narrow-mobile browser verification completed.

## Inventory and compatibility

- RTX 3090: ComfyUI 0.35.1, frontend 1.51.10, prompt-specific cancellation, preview metadata, local `taeh3.safetensors` present.
- RTX 5060 Ti: ComfyUI 0.34.2, frontend 1.49.6, prompt-specific cancellation, preview metadata, no current TAEH3 decoder asset.
- The two H3 backends retain their distinct qualified workflow profiles and eight-step graphs.
- Canonical style count: 62 entries = default + 61 creative concepts.
- Questionable overlaps are preserved, not silently merged: broad Anime vs specialized decade/genre anime; broad Cartoon vs specialized cartoon styles; Cinematic realism vs specialized realistic/cinematic variants.
- Legacy Prompt Builder style labels resolve through explicit aliases. Newer stable Style Art IDs are unchanged. Production scene normalization migrates legacy labels into `visualStyleId` while retaining the legacy broad mapping.
- Direct H3 jobs and Gallery submit metadata now retain the canonical `stylePresetId`.

## Cancellation behavior

- Both current backends use ComfyUI's prompt-specific cancel endpoint first.
- The compatibility fallback runs under the existing backend submission critical section, deletes only the exact queued prompt, and issues global `/interrupt` only after atomically re-reading the queue and proving the exact requested prompt is the sole active prompt.
- Jobs remain `canceling` until the exact prompt is absent. Direct-job GET polling and the Production scheduler reconcile delayed interruption and restarts.
- `canceled` is terminal and distinct from `failed`; canceled jobs are excluded from waiting work and cannot transition into native-ready, VSR, completion, failure, or automatic retry stages.

## Live preview status

- The application creates a dedicated ComfyUI WebSocket client before submission, reuses its `client_id`, binds the accepted `prompt_id`, validates binary preview metadata, stores only the latest frame, and relays owner-authenticated events/frame reads.
- Preview failure is non-fatal to generation. The UI labels it **Approximate Preview** and keeps cancellation available.
- Core Latent2RGB is the no-install baseline. No third-party custom node was installed or enabled.
- Controlled GPU validation remains required before enabling the feature: preview quality/frame count, peak VRAM, wall-clock impact, cancellation latency, reconnect behavior, and final-output integrity on both backend graphs are not yet measured.

## Style media and selector

- Categories: Default; Realistic & Live Action; Animation; Illustration & Graphic; Gaming; Genre & Cinematic; Experimental.
- Browser view uses optional still posters only. The selected style alone may load one looping, muted, inline MP4/WebM preview.
- No nonexistent asset URLs are emitted: only reviewed files listed in `lib/h3StyleMediaManifest.json` are requested.
- Missing media leaves the style fully functional and shows a compact fallback.
- Standardized comparison scene is in `docs/h3-style-preview-standard-scene.json`.
- `scripts/h3-style-preview-assets.mjs` extracts a reviewed one-second portion, encodes H.264 MP4, optionally WebM, creates a WebP poster, updates the manifest, and validates published files.

## Phone access

- Port 8785 is served by `/home/shawn-rochford/AI/Hailuo-H3-Prompt-Builder-Standalone/server.py` through `hailuo-h3-prompt-builder.service`.
- Current systemd launch remains `--port 8785` and binds `127.0.0.1` only.
- The server already supports explicit `--phone-access` (`0.0.0.0`) but has no authentication and exposes shared prompt history to reachable clients.
- The safe development recommendation is Tailscale-interface-only firewall access. Current address observed during audit: `http://100.75.162.64:8785/`; recheck with `tailscale ip -4`.
- No service/firewall change was applied.

## Verification

- `npx tsc --noEmit`: passed.
- Vitest: 103 files, 514 tests passed.
- Next.js optimized build: passed (66 static pages; new H3 preview routes included).
- Style-media validator: passed with zero published entries.
- Encoder smoke: exact 1.000-second H.264 output, poster, WebM, and manifest validation passed using synthetic local footage; temporary artifacts removed.
- Standalone Prompt Builder: four security tests and Python compilation passed.
- Browser: compiled runtime at 375 px, no error overlay, no console errors, no horizontal overflow with a 500-character unbroken prompt; unified selector showed all 62 entries and loaded no unpublished media.
- Known unrelated development limitation: `next dev` currently bundles Node-only `fs` through preexisting `instrumentation.ts` startup imports and returns a development overlay. The optimized/TEST-style compiled runtime succeeds. This project did not rewrite that unrelated startup architecture.

## Approval-gated/manual work remaining

1. Approve small controlled preview-on/off H3 benchmarks on both GPUs. This is needed for real VRAM, speed, quality, and cancellation measurements.
2. Review TAEH3 provenance/checksum and decide whether to place a decoder on the 5060 Ti after baseline measurements.
3. Approve Phase 10 mass five-second style generation. Every result then needs manual visual selection of its representative one-second segment.
4. Package and activate a TEST release, then run authenticated end-to-end generation/cancellation/reconnect/final-output checks.
5. Approve PROD only after the TEST acceptance report. No PROD files or services were changed.
