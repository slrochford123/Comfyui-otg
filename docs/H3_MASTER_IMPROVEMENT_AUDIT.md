# H3 Master Improvement Project — Phase 0 Audit

Audit date: 2026-09-16. Scope: source and TEST inventory only; no PROD deployment and no inference run.

## Application paths

- H3 Generate UI: `app/app/components/H3Panel.tsx`
- Direct H3 API and persisted jobs: `app/api/h3/generation/route.ts`, `lib/h3DirectJobs.ts`
- Production Pipeline UI/API: `app/app/components/ProductionV2Panel.tsx`, `app/api/production/v2/generation/route.ts`
- Production job store and scheduler: `lib/production/h3GenerationJobs.ts`, `lib/production/h3GenerationScheduler.ts`
- ComfyUI integration and workflow graphs: `lib/production/h3Comfy.ts`, `lib/production/h3Workflows.ts`
- Existing Prompt Builder options: `lib/production/promptOptions.ts`
- New Style Art presets: `lib/h3StylePresets.ts`
- Standalone Prompt Builder: `/home/shawn-rochford/AI/Hailuo-H3-Prompt-Builder-Standalone`

## Current runtime architecture

- Next.js 15.5.18, React 19.2.1, Node 20.
- Direct H3 jobs are owner-scoped JSON records under the OTG data root.
- Production H3 jobs are durable SQLite records in `production_v2_generation_jobs`.
- The Production scheduler submits native H3, downloads its output, then submits RTX VSR post-processing.
- Prompt submission is serialized through a short per-physical-GPU application lock.
- The current application polls ComfyUI history; it does not yet relay ComfyUI WebSocket preview frames.

## Current H3 backends

| Backend | Current ComfyUI | Frontend | Workflow distinction | Prompt-specific cancel |
| --- | --- | --- | --- | --- |
| RTX 3090 | 0.35.1 | 1.51.10 | backend-specific graph/profile | supported |
| RTX 5060 Ti | 0.34.2 | 1.49.6 | backend-specific graph/profile | supported |

Both report preview-metadata capability. The backends are shared infrastructure, so third-party decoder installation is not safe as an unreviewed TEST change. Live decoder work must remain feature-gated until an isolated TEST path is confirmed.

## Prompt Builder and styles

- Existing Prompt Builder visual styles: 28.
- New Style Art entries: 34 including `none`, or 33 creative presets.
- Initial combined inventory: 61 creative concepts plus the default/none selection before duplicate adjudication.
- Broad styles and specialized descendants are intentionally preserved. Examples requiring review include Anime/1980s Anime, Cartoon/specialized cartoon presets, and Cinematic Realism/specialized photorealistic presets.
- Camera feel, shot flow, lighting, motion, framing, and other independent Prompt Builder controls must remain separate from the visual-style registry.
- Existing style IDs, saved values, prompt instructions, scene metadata, and local state require aliases rather than destructive renames.

## Standalone Prompt Builder / port 8785

- Served by `server.py --port 8785` through `hailuo-h3-prompt-builder.service`.
- Current service binds to `127.0.0.1`, which is host-only.
- The server already supports `--phone-access`, which binds to `0.0.0.0`; the service unit does not currently enable it.
- Trusted LAN/Tailscale access is feasible, but must not be opened publicly and should retain the existing authentication/security boundary.

## Principal compatibility risks

1. Cancellation races between submission acceptance, scheduler polling, native download, and VSR submission.
2. A legacy global ComfyUI interrupt can affect another job unless the exact active prompt is revalidated under the submission lock.
3. Direct-job JSON and Production SQLite use different state models; additive states and compatibility defaults are required.
4. Style definitions currently have two sources and multiple consumers; migrating consumers before deleting compatibility code is mandatory.
5. The 3090 and 5060 Ti use different workflow profiles; preview compatibility cannot be inferred from one backend.
6. Shared ComfyUI instances make unreviewed custom-node installation a cross-user risk.
7. Existing dirty working-tree changes are user-owned and must remain intact.

## Phase decisions

- Incrementally extend the existing job models rather than introduce a second job system.
- Use prompt-specific cancellation on both current backends; retain a guarded legacy fallback.
- Keep experimental live decoding behind a TEST feature flag.
- Build one canonical style registry with compatibility aliases, then migrate consumers one at a time.
- Build media support and validation before requesting approval for mass preview generation.
