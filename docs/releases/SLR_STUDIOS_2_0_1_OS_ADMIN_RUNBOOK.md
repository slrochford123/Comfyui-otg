# SLR Studios 2.0.1 compatibility/security — OS-admin runbook

This is a preparation document, NOT authorization to activate PROD. The owner
must review TEST validation and the new immutable GitHub revision first.
Never move `v2.0.0` or deploy an unpublished dirty candidate to PROD.

## Routing schema

| Environment | Logical target | Explicit agent host | Port |
| --- | --- | --- | --- |
| TEST | 3090 | shawn / 100.75.162.64 | 8801 |
| TEST | 5060ti | slr / 100.98.212.116 | 8801 |
| PROD | 3090 | shawn / 100.75.162.64 | 8802 |
| PROD | 5060ti | slr / 100.98.212.116 | 8802 |

These are deployment values, not application fallbacks. The web process can run
on either host without changing logical identity. An agent pins both environment
and physical GPU; it accepts only status/reset_comfy/free_vram. No shell, host,
port, service or command can be supplied by a browser request.

Variable names/schema are in `config/maintenance.env.example`. Secret values
must never appear in Git, reports, browser responses or command arguments.
Prefer private regular `TOKEN_FILE` files (0600), not inline environment tokens.

## Immediate TEST-agent installation

On the **3090 machine**, from the reviewed source:

```bash
sudo bash scripts/maintenance/install-agent.sh test 3090 100.75.162.64
systemctl is-active slr-maintenance-test-3090.service
```

On **slr / 5060Ti**, from the reviewed source:

```bash
sudo bash scripts/maintenance/install-agent.sh test 5060ti 100.98.212.116
systemctl is-active slr-maintenance-test-5060ti.service
```

The installer starts only the agent. It never resets a GPU or restarts Comfy.
Private TEST delivery copies are placed under the invoking OS admin's
`.config/slr-maintenance/` directory. Securely copy the 5060Ti delivery file to
TEST's web host; do not display its contents. The web client reads only TEST
keys when `OTG_ENV=test`. Both agents and the guarded TEST activation must be
available before physical UI maintenance testing. Do not use the old 8799
TEST-only token as a PROD credential.

## Protected PROD safeguard — root on slr

Before any future activation, run from the reviewed compatibility source:

```bash
sudo python3 scripts/maintenance/backup-prod-protected.py
```

This backs up the three previously inaccessible files:

- `/opt/otg/env/.worker-token`
- `/opt/otg/env/.env.prod-admin-gallery`
- `/etc/otg/otg-prod-video-backend.env`

It also copies the main PROD environment/systemd configuration and makes fresh
online backups of the five persistent databases. All outputs are private.
No contents are printed. Run it AGAIN immediately before actual activation;
earlier snapshots are not substitutes for a fresh activation safeguard.

## Future PROD-agent installation — NOT executed in this pass

After owner review, on **3090**:

```bash
sudo bash scripts/maintenance/install-agent.sh prod 3090 100.75.162.64
systemctl is-active slr-maintenance-prod-3090.service
```

On **slr / 5060Ti**:

```bash
sudo bash scripts/maintenance/install-agent.sh prod 5060ti 100.98.212.116
systemctl is-active slr-maintenance-prod-5060ti.service
```

`systemctl daemon-reload`, unit enablement and agent startup are performed by the
installer. No Comfy or web service restart is part of agent installation.
Each PROD credential is newly generated into its own private file under
`/etc/otg-maintenance/prod/`. Existing keys are retained on an idempotent rerun.
The PROD agent never reads TEST credential files and rejects TEST envelopes.

### Secure delivery of the 3090 PROD client credential

The PROD web host is slr. Do not print a credential or pipe it through a terminal.
On **3090**, create a private OS-admin delivery copy:

```bash
mkdir -p /home/shawn-rochford/.config/slr-maintenance
chmod 700 /home/shawn-rochford/.config/slr-maintenance
sudo install -o shawn-rochford -g shawn-rochford -m 600 \
  /etc/otg-maintenance/prod/3090.token \
  /home/shawn-rochford/.config/slr-maintenance/prod-3090.token
ssh otg-slr 'mkdir -p /home/slrochford123/.config/slr-maintenance; chmod 700 /home/slrochford123/.config/slr-maintenance'
scp /home/shawn-rochford/.config/slr-maintenance/prod-3090.token \
  otg-slr:/home/slrochford123/.config/slr-maintenance/prod-3090.token
```

Then, on **slr**, install the web-readable secret without echoing it:

```bash
sudo install -d -o root -g root -m 700 /opt/otg/env/maintenance
sudo install -o root -g root -m 600 \
  /home/slrochford123/.config/slr-maintenance/prod-3090.token \
  /opt/otg/env/maintenance/prod-3090.token
```

The existing root-owned PROD service can read that file. The 5060Ti PROD client
can read its own local `/etc/otg-maintenance/prod/5060ti.token`. If a later
least-privilege web user is introduced, grant only that account an appropriate
private delivery copy; never loosen permissions globally. Retire delivery copies
through a reviewed secret-management step, not a broad cleanup command.

## PROD configuration preparation — preserve existing values

Create a new private `/opt/otg/env/.env.prod-compat` using `sudoedit`, not a copy
of TEST's environment. Use only the PROD-prefixed endpoint/credential-file keys
from the schema, `OTG_ENV=prod`, and the existing PROD allowed origins. Add it as
an additional systemd EnvironmentFile only in the final guarded transaction.
Do not overwrite any existing authentication, worker, billing or Gallery secret.

Set `OTG_CONFIG_ROOT` to a stable PROD-owned configuration directory and
`OTG_RUNTIME_ROOT` to an installed PROD runtime directory. MOSS and LTX proof
files must explicitly identify environment `prod` and represent legitimate
qualification on the configured workers. TEST qualification records are NOT
accepted as PROD proof. Absence remains unqualified, not false Ready.

Configure voice Python, Seed-VC/Applio/AuK, Demucs, diarization and Comfy I/O paths
to installed dependencies on the actual execution host. Do not copy a virtualenv
with stale interpreter prefixes or user QA media as an installation strategy.
Physical voice workers sharing a GPU must use the same explicit
`OTG_VOICE_GPU_LOCK_FILE` on that execution host. Existing installed model aliases
containing TEST in their filenames are model identifiers, not permission to copy
QA records or credentials. Inventory/hash actual assets before reusing them.

Set each Admin Gallery source's explicit `OTG_ADMIN_GALLERY_3090_ROOT` or
`OTG_ADMIN_GALLERY_3090_URL`, and the corresponding 5060 keys, to that GPU's real
storage or existing authenticated Gallery agent. Generic Comfy output never
implies 3090 ownership. Preserve the existing independent Gallery credentials.

For optional H3 LoRA file administration, set `OTG_H3_LORA_LOCAL_BACKEND` to
`rtx5060ti` on PROD and `rtx3090` on TEST. Set both explicit LoRA roots and the
remote target's trusted `OTG_H3_RTX3090_SSH_HOST` or
`OTG_H3_RTX5060TI_SSH_HOST` deployment alias. These are server-owned configuration,
never browser inputs. The existing single-file SSH deletion implementation
remains constrained to the selected MiniMax-H3 root and refuses symlink escapes;
no local or SSH-host fallback is inferred from a logical GPU name. Do not enable
remote deletion until the deployment account's restricted access is reviewed.

The HDR custom-node source now accepts `OTG_LTX_HDR_DEPENDENCIES` in the COMFY
worker environment. Install its pinned OpenImageIO dependency into a stable
dependency location; never make PROD depend on a disposable qualification folder.
Keep the existing `TESTLTXHDRExport` class ID for graph compatibility. Do not
overwrite/restart an in-use Comfy worker during installation.

## Node22 and package preparation

### Deterministic TEST runtime activation

The original `zz-compat-node22.conf` lost to
`zzzz-story-creator-unified-node20.conf` and
`zzzzz-test-managed-node20.conf`. A manually installed later override recovered
TEST, but is not the deployment fix. Tracked activation now lives in
`scripts/deploy/activate_test_release.py` and `systemd_runtime.py`.

The helper reloads systemd, discovers applied drop-ins, installs a new override
strictly after the current lexicographic maximum, reloads again, and requires
the exact effective Node22 ExecStart before switching/restarting. It probes
candidate SQLite/Sharp using the intended Node22 binary without rebuilding.
After restart it checks `/proc/PID/exe`, CWD, effective command and HTTP health.
Failure restores the previous pointer and removes only its own new override;
legacy and owner overrides are never deleted. This helper is TEST-only.

```bash
sudo python3 scripts/deploy/activate_test_release.py \
  --expected-current /absolute/expected/test3001-release \
  --candidate /absolute/new/test3001-release
```

The paths must be real additive releases under the TEST release parent. For
read-only validation of the already running release, use the same current path
for both arguments plus `--check-only`, without sudo. The legacy restoration
script delegates to this guarded helper; its template no longer installs Node20.
Focused Python regression reproduces the exact legacy-precedence failure.

This revision requires Node22.23.4; do not change `/usr/bin/node` underneath the
old PROD release. Prepare a separate root-owned runtime at
`/opt/otg/runtime/node-v22.23.4`. Use the official Node distribution and its
matching SHA256 manifest; do not run a third-party installation shell script.

On slr, these downloads/checks can run as the OS deployment user in a new private
temporary directory before installation:

```bash
set -euo pipefail
work_dir="$(mktemp -d)"
cd "$work_dir"
curl --fail --location --proto '=https' --tlsv1.2 \
  -O https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz
curl --fail --location --proto '=https' --tlsv1.2 \
  -O https://nodejs.org/dist/v22.23.4/SHASUMS256.txt
grep ' node-v22.23.4-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check -
test ! -e /opt/otg/runtime/node-v22.23.4
sudo install -d -o root -g root -m 755 /opt/otg/runtime/node-v22.23.4
sudo tar -xJf node-v22.23.4-linux-x64.tar.xz \
  --strip-components=1 --no-same-owner -C /opt/otg/runtime/node-v22.23.4
/opt/otg/runtime/node-v22.23.4/bin/node --version
```

Do not extract over an existing runtime without verifying its exact version and
contents first. Preserve the old Node20 runtime for application rollback.

Only after v2.0.1 is published and TEST physically passes: obtain the exact
verified GitHub SHA, build a new immutable PROD package using its committed lock
under Node22, and probe its SQLite/Sharp native modules on slr. Link EXISTING
`/var/lib/otg`, existing PROD environment files and existing storage. Never use
the TEST package's data/env symlinks. Existing PROD `.env.local` values must be
preserved in a stable config path, not linked through `current-prod` recursively.

Rehearse additive migrations on consistent backup copies. Smoke the package on
an alternate loopback port with copied/scratch data, never triggering a live
migration as a preflight shortcut. Verify both PROD maintenance agent identities
and missing-auth/invalid-auth rejection without resetting either GPU.

## Eventual activation — separate owner approval required

There is intentionally NO activation command that bypasses these gates.
The final reviewed activation transaction must:

1. Verify the exact tagged SHA and unchanged expected old PROD target.
2. Verify native Node22 probes, environment/data/storage links and worker routes.
3. Run the protected backup helper immediately before activation.
4. Save the existing systemd/drop-in state; prepare a last-sorting override with
   the new Node22 ExecStart and additional PROD compatibility EnvironmentFile.
5. Atomically switch only `/opt/otg/current-prod` to the new immutable package.
6. Execute `sudo systemctl daemon-reload` and
   `sudo systemctl restart otg-prod.service` ONLY inside that guarded transaction.
7. Verify new PID, `/proc` CWD, Node executable, local/public health, authentication,
   retained user IDs/data and real PROD Android access.
8. On failure, restore the old pointer and old drop-in state, daemon-reload and
   restart only `otg-prod.service`. NEVER restore a stale DB/media snapshot over
   newer user activity as an application rollback.

The actual old target discovered in this pass is
`/mnt/otg_bulk/slr-offload/opt-otg/releases/prod-forward-ai-assistance-20261019T20261019T214829`.
Recheck it live before generating the final transaction. Do not use the historical
local 20260930 pointer as the serving PROD target.

The Android security fix also requires a later owner-signed PROD native package
with the existing `com.slr.otg` identity. Only the QA package is installed in this
pass. Never replace PROD with `com.slr.otg.test`, clear app data, or assume that
a web-only deployment patches an already installed vulnerable native wrapper.
