# SLR Studios 2.0.0 — owner-approved major standard

Accepted TEST release: `test3001-moss-v2v-light-branding-20261022T142319Z`.

This release preserves the owner's accepted application source. Promotion-only
changes are release identity/version metadata and repository safety exclusions.
Owner acceptance is not a claim that an automated test alone certifies physical
behavior. Environment-specific settings, credentials and runtime data are not
part of this source release.

## Included functionality

- MOSS-Image SFT on the configured RTX3090 and RTX5060Ti image lanes, including
  Characters, Freeform Characters, Backgrounds and Assets, with explicit Gallery
  saving and truthful readiness.
- H3 Edit Video with full source-frame Fun ControlNet conditioning, 2–10-second
  validation, legal frame-grid preparation, source-duration finalization and
  confirmed cancellation/retry.
- Shared Light Mode tokens, Classic/mobile layout repairs, launch intro and
  official Android/PWA branding assets. TEST and PROD Android identities remain
  separate; existing installed PROD identity is not replaced by the QA flavor.
- Qualified LTX Studios workflows, Edit Anything, character replacement,
  cancellation safety, ACE-Step integration and voice/dialogue workflows.
- Owner-scoped media compatibility, Production/Character associations, account
  session migration, security gates and constrained Admin maintenance tooling.

## Reproducible verification

Use Node20.20.2 and the committed dependency lockfile. `npm ci --legacy-peer-deps`, `npm test`,
`npx tsc --noEmit`, and `npm run build` are the supported web gates. Vitest's
committed deterministic single-worker configuration is intentional. Maintenance
security and dataset wait/cancel Python tests live under `scripts/test-maintenance`.

The accepted lockfile contains a model-viewer/Three.js peer-range disagreement;
the explicit install flag retains its accepted resolved versions rather than
upgrading dependencies during promotion. The OpenAI package also declares a
newer Node engine than this application's pinned Node20 runtime; this is an
existing compatibility warning, not a dependency change in this release.

## Deployment constraints

Build a new immutable release from the tagged commit. Keep persistent PROD
databases, media and credentials outside release directories. Never seed PROD
from TEST. Verify additive schema migration on a consistent backup before
activation. Preserve the previous release and a guarded rollback command.

Private release evidence, QA users/media, credentials, model weights and local
runtime data are deliberately excluded from GitHub. Model/workflow references
and reviewed dependency-installation source remain tracked.
