# SLR Studios 2.0.1 — scoped security review

This is a compatibility/security candidate, not a claim of current PROD
remediation or 100% physical certification. PROD activation is not authorized
in this pass. Published `v2.0.0` remains immutable.

## Runtime decision

Use Node22.23.4 from its checksum-verified official distribution, instead of downgrading the
accepted OpenAI7.33.0 SDK to an older release. Official OpenAI documentation
requires Node22 and states that Node20 reached end of life on April30,2026:
https://developers.openai.com/api/reference/typescript

The current Node22 security patch also fixes TLS, DNS and Brotli findings:
https://nodejs.org/en/blog/release/v22.23.4

This decision addresses unsupported runtime/security maintenance, not merely an
npm warning. The SDK stays at7.33.0. Node22 is required by package engines,
`.nvmrc` and the native-dependency check. SQLite is probed in fresh processes so
a failed old-ABI load cannot poison a post-rebuild probe. The clean install,
native SQLite/Sharp operations, SDK Responses/SSE/multipart tests, full suite,
typecheck and build must pass. Managed TEST activation and physical smoke remain
independent required gates. Do not change PROD's existing Node20 executable.

## All 13 original package-level audit findings

The original 13 entries were package-level dependency findings, not 13 distinct
CVEs. Five remaining high entries are propagation of one unpatched development
parser issue. Original severity is retained below; reachability is not used to
silently downgrade its published severity.

| Package / original version | Severity / dependency | Exposure and exploit preconditions | Minimal candidate resolution / fixed release | Residual / breaking risk |
| --- | --- | --- | --- | --- |
| @capacitor/android7.6.4 | Critical; direct native runtime | Android WebView internal proxy can load remote content at the application origin; relevant to the installed remote-content wrapper |7.6.9; native QA package rebuilt and installed with same package/signing identity | Same7.x patch; a later owner-signed PROD APK is required, not just a web deploy |
| sharp0.34.5 | High; direct runtime | Uploaded image decoding reaches native image libraries; attacker-controlled supported image content is relevant |0.35.5 with patched libvips/libheif/librsvg artifacts | Necessary0.x minor transition; actual native resize/encode and invalid-input recovery tests added; affected Android upload/preview smoke required |
| postcss8.5.10 under Next | High; transitive runtime/build dependency | Source-map loading can disclose files when processing attacker-controlled CSS/mapping comments; SLR compiles trusted source, not uploaded CSS, but the affected package was present | Explicit Next override8.5.29; verified nested lock resolution, not just package.json | Same8.x patch; no Next major upgrade |
| next15.5.27 | Moderate; direct runtime | Audit propagation from nested PostCSS | Keep15.5.27, repair its nested PostCSS | No framework API migration; finding removed from candidate audit |
| vitest3.2.7 | Critical; direct development | Propagates vulnerable mocker/tinypool; network/mock-registration and attacker-influenced worker options are relevant preconditions |4.1.12 with the existing Vite6 line | Necessary test-only major for known security fixes; deterministic one-fork full suite requalified; not shipped |
| @vitest/mocker3.2.7 | Moderate; transitive development | Arbitrary file read/code injection through exposed mock registration/redirect controls |4.1.12 via Vitest | Not shipped; no unauthenticated test server in CI |
| tinypool1.1.1 | Critical; transitive development | Prototype-polluted/untrusted worker run options can yield code execution | Removed from the candidate dependency graph by patched Vitest architecture | Not shipped; no runtime pool reliance |
| @vitest/coverage-v83.2.7 | Moderate; direct development | Audit propagation through vulnerable Vitest |4.1.12 matching Vitest | Coverage APIs remain test-only; full test gate required |
| braces3.0.3 | High; transitive development | Deep attacker-controlled brace patterns can exhaust the stack | No patched braces release available at audit; retain3.0.3 only in development lint chain | Residual documented: trusted repository-owned lint patterns only; excluded from deployed package |
| micromatch4.0.8 | High; transitive development | Propagates braces issue when untrusted glob patterns are expanded | Retain; no compatible patch removes the underlying issue | Same trusted-input restriction; excluded from deployed package |
| fast-glob3.3.1 | High; transitive development | Propagates micromatch/braces issue | Retain; no underlying patched parser available | Only repository lint/file discovery; excluded from deployed package |
| @next/eslint-plugin-next16.0.10 | High; transitive development | Propagates fast-glob chain; not imported by application APIs | Retain; avoid misleading automatic downgrade suggestion | Non-shipped; trusted maintained source/config only |
| eslint-config-next16.0.10 | High; direct development | Propagates plugin chain | Retain16.0.10; audit suggests unrelated14.2.35 major downgrade, not a minimal parser patch | Downgrade changes lint configuration/API without fixing a deployed application dependency; no production benefit justifies it |

The candidate runtime audit (`npm audit --omit=dev`) reports zero vulnerabilities.
The complete development-inclusive audit reports five high findings, zero
critical and zero moderate. Named lint/glob packages, Vitest and tinypool are
explicitly checked absent from the packaged standalone node_modules.

### Affected ranges from the original audit snapshot

Ranges below preserve the original audit report. A propagated range is the
reported dependency-chain exposure, not a newly discovered independent CVE.

| Package | Reported affected range | Patched disposition |
| --- | --- | --- |
| @capacitor/android | >=7.0.0 <7.6.9 | 7.6.9 |
| sharp | <0.35.0 libvips; <0.35.4 libheif; <0.35.5 librsvg | 0.35.5 covers all three |
| postcss | <=8.5.11 original source-map issue; <=8.5.17 traversal; <=8.5.22 incomplete fix | 8.5.29 covers all three |
| next | 9.3.4-canary.0 through 16.3.0-preview.10, propagated PostCSS finding | Keep 15.5.27 with patched nested PostCSS |
| vitest | 0.0.95 through 4.1.10, original propagated audit range | 4.1.12 removes vulnerable pool and patches mocker |
| @vitest/mocker | >=2.1.0 <4.1.11 traversal; >=2.1.0-beta.7 <4.1.12 mock registration | 4.1.12 |
| tinypool | <=2.1.0 worker options; <2.1.2 run options | Removed; standalone fixed version is 2.1.2 |
| @vitest/coverage-v8 | 2.1.0-beta.1 through 4.1.10, propagated | 4.1.12, matched to patched Vitest |
| braces | <=3.0.3; audit aggregate `*` | No patched release at audit |
| micromatch | >=0.2.0, propagated | No available underlying braces fix |
| fast-glob | `*`, propagated | No available underlying braces fix |
| @next/eslint-plugin-next | >=14.3.0-canary.0, propagated | Non-shipped lint chain retained |
| eslint-config-next | >=14.3.0-canary.0, propagated | Non-shipped lint chain retained |

Do not claim npm audit proves absence of every possible vendored vulnerability.
The deployment exposure assessment additionally relies on no public lint/test
server and no application route passing untrusted glob patterns to lint tools.
CI must not run attacker-controlled repositories, configuration or patterns with
privileged secrets. Normal pull-request code execution remains a separate CI
trust boundary. Do not use `npm audit fix --force` as a release gate shortcut.

## Primary advisories

- Capacitor: CVE-2026-103922, https://github.com/advisories/GHSA-rvm3-566m-v7fv
- Mocker: CVE-2026-84373, https://github.com/advisories/GHSA-82fw-gwwq-j7x9
- Mocker: CVE-2026-112949, https://github.com/advisories/GHSA-qxg6-89mg-rqv8
- Tinypool: CVE-2026-104848, https://github.com/advisories/GHSA-5gmw-xhrv-c9v3
- Tinypool: CVE-2026-104849, https://github.com/advisories/GHSA-85c8-ppgw-ccpr
- PostCSS: CVE-2026-45623, https://github.com/advisories/GHSA-6g55-p6wh-862q
- PostCSS: CVE-2026-69153, https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
- PostCSS: CVE-2026-73646, https://github.com/advisories/GHSA-r28c-9q8g-f849
- Sharp: https://github.com/advisories/GHSA-f88m-g3jw-g9cj
- Sharp: https://github.com/advisories/GHSA-rgj7-g3m4-5g8c
- Sharp: https://github.com/advisories/GHSA-wq5f-xc86-pv6w
- Remaining braces issue: CVE-2026-93687, https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

## Additional security fixes discovered during portability work

1. Legacy `/api/Delete`: unauthenticated filesystem deletion and user-selected
   worker-root fields. It now authenticates first, rejects filename traversal,
   and delegates only to existing owner-scoped Gallery-copy deletion. Shared
   worker outputs are never deleted by this compatibility endpoint.
2. Legacy Character voice preview/pack: header-selected output ownership is
   replaced with authenticated server owner identity. Voice pack references
   require owner-scoped realpaths; cross-owner and symlink escapes are denied.
3. Legacy Character3D: generation and downloads require authentication and
   owner-scoped media. Model outputs/record updates are namespaced by the
   authenticated owner, not a shared device-label directory. Existing records
   are not deleted, migrated or reassigned. Ambiguous legacy shared-directory
   data is not granted to arbitrary users; any needed owner mapping requires
   explicit provenance rather than a permissive fallback.

Focused denial/delegation/realpath tests cover these repairs without deleting
real media, generating models or accessing another real user's data.

## Portability boundary

Maintenance endpoints and credentials are explicit per environment and target.
The web host's GPU and hostname never determine the target, and the web API has
no local sudo/helper fallback. Agents enforce their own physical GPU identity,
fixed service profiles, environment authentication, queue refusal, transaction
locks and replay/double-tap protection. Errors do not echo upstream credentials.

MOSS/LTX proof paths, voice runtimes, Demucs/diarization, Admin Gallery's local
root and Comfy I/O have stable configuration-backed paths. TEST overrides retain
existing installed locations; PROD defaults do not point into a TEST home path.
Proof registries are environment-scoped and fail closed if a deployed process
has no explicit environment. Historical TEST strings used only to identify and
remap legacy saved-media URLs are not live TEST storage fallbacks: existing
owner and realpath authorization still apply.

The same host assumption was also removed from Admin Gallery's generic output
fallback and optional H3 LoRA file deletion. Each Gallery source now requires its
own explicit local root or remote URL. LoRA deletion requires an explicit local
backend identity; a remote backend uses only a trusted configured SSH alias and
the existing fixed, realpath-checked single-file operation, never browser-supplied
SSH parameters. Missing configuration fails closed. This is separate from GPU
maintenance, which uses only the authenticated HTTP agents and never SSH.

See `SLR_STUDIOS_2_0_1_OS_ADMIN_RUNBOOK.md` for root steps and independent
credentials. No PROD environment, service, source, users, storage or GPU operation
has been changed by preparing this revision.

## Activation precedence regression

The original fixed-name `zz-compat-node22.conf` lost to later legacy Node20
drop-ins. The tracked TEST activation helper now discovers the applied filenames,
chooses a strictly later override, verifies the effective ExecStart after
daemon-reload, and verifies `/proc/PID/exe`, CWD and health after restart. It never
invokes a package rebuild. Failure removes only its own override and rolls back
the application pointer/runtime. The old restoration script delegates to this
helper and its template no longer selects Node20. Fourteen focused Python tests
cover the exact two legacy filenames, contradictory effective commands, wrong
process binaries, real pointer/override rollback in a sandbox, and preservation
of pre-existing overrides.
