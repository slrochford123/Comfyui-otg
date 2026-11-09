# Final Export Studio source and build

The embedded editor uses the modified Sequence source in `vendor/sequence`,
based on upstream commit `8f301707e61d60e69abd6becba9a02c9aa94d489` from
https://github.com/alamkanak/sequence. Its AGPL-3.0-only license and third-party
notices are retained there. `vendor/sequence/OTG_CHANGES.md` describes the changes.

Use Linux with GNU tar, Node 22.23.4 (see `.nvmrc`) and npm 10 or later. The
upstream full development toolchain declares Node 24; this embedded frontend
uses the separately qualified Node 22 Vite build. Existing host media services
and FFmpeg/ffprobe are separate runtime requirements; building does not install
models or start those services.

From the root of a clean checkout or the extracted `otg` source directory:

```sh
npm ci
npm run build
```

The root postinstall retains the native dependency check and installs the
editor's locked dependencies with `npm --prefix vendor/sequence ci --ignore-scripts`.
Prebuild runs the native check, the editor's TypeScript check, and its
`vite.otg.config.ts` build. It then prepares `timeline-editor/` before Next builds.
No separate manual editor build or downloaded prebuilt bundle is required.
The upstream SEO and optional AI companion builds are not used by the embed.

The generated `timeline-editor/` contains the frontend, `LICENSE.txt`,
`THIRD_PARTY_NOTICES.txt`, this document, provenance, and `source.tar.gz`.
Next's standalone file tracing includes this directory; deployments must retain
it beside the standalone `server.js`, along with the usual Next static files
and public assets. Configure the host environment and persistent data paths
locally using the deployment's existing settings; secrets and live data are
never part of the source download.

Signed-in users can download the corresponding source at
`/api/timeline-editor/app/source.tar.gz` through the editor's source/license link.
The archive contains the actual host app, libraries, configuration, build and
runtime scripts, workflow definitions, tests, public assets, root lockfile, and
complete modified editor source. It excludes environment files, credentials,
local symlinks, databases, private QA scripts, dependencies, caches and build
output. Both package lockfiles are included so `npm ci` resolves the same
declared dependencies. The bundled license and notices are served through the
same authenticated route.

Host TypeScript, Vitest, Playwright and ESLint exclude `vendor/`; the editor's
TypeScript check runs separately during every normal build. For upstream
editor tests, use its own configuration from `vendor/sequence`.
