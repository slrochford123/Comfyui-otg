# OTG Final Export Studio integration

This copy of Sequence is modified for OTG on 2026-11-09.

Upstream source is https://github.com/alamkanak/sequence at commit 8f301707e61d60e69abd6becba9a02c9aa94d489. The original AGPL-3.0-only license is retained.

The OTG entry point loads an authenticated project, saves source media and project revisions to the signed-in OTG account, imports Gallery clips, and records completed browser exports. Mobile panel switching and project-specific browser storage were added. The optional local AI companion is disabled in embedded mode.

Build the embedded editor with Node 22.23.4 or a compatible supported Vite runtime, npm ci --ignore-scripts, and npx vite build --config vite.otg.config.ts. The upstream full development toolchain declares Node 24. The embedded frontend was separately built and tested on Node 22.23.4.

The source archive includes the modified editor, license notices, package lock, and OTG integration sources.

LAN HTTP identity generation uses secure getRandomValues when randomUUID is unavailable. Model, clip, export and worker file identities share this implementation. Completed export uploads retain the project-switch lock until server persistence finishes.

The embedded studio adapts its panels and timeline to short landscape phone viewports. OTG provides compact project controls and a fullscreen phone orientation toggle.

Final Export Studio is available to authenticated TEST and PROD users. Each deployment uses its own configured data root. The other experimental workspaces retain their existing TEST restrictions.
