#!/usr/bin/env bash
set -euo pipefail

EXPECTED_HOST="shawn"
EXPECTED_USER="shawn-rochford"

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_DIR="$SCRIPT_DIR/test-runtime"

LAUNCHER_SOURCE="$SOURCE_DIR/launch.cjs"
HELPER_SOURCE="$SOURCE_DIR/otg-wait-for-tailscale-ip.sh"
DROPIN_SOURCE="$SOURCE_DIR/95-tailscale-ready.conf"

LAUNCHER_TARGET="/home/shawn-rochford/AI/services/otg-test/launch.cjs"
HELPER_TARGET="/usr/local/libexec/otg-wait-for-tailscale-ip.sh"
DROPIN_TARGET="/etc/systemd/system/otg-test.service.d/95-tailscale-ready.conf"

NODE="/home/shawn-rochford/.nvm/versions/node/v20.20.2/bin/node"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/home/shawn-rochford/AI/preservation/install-test-runtime-$STAMP"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [ "$(hostname -s)" != "$EXPECTED_HOST" ]; then
  fail "TEST runtime installer is restricted to host $EXPECTED_HOST"
fi

if [ "$(id -un)" != "$EXPECTED_USER" ]; then
  fail "TEST runtime installer must run as $EXPECTED_USER"
fi

if [ "$EUID" -eq 0 ]; then
  fail "TEST runtime installer must run unprivileged; sudo is used only for protected destinations"
fi

for source_file in "$LAUNCHER_SOURCE" "$HELPER_SOURCE" "$DROPIN_SOURCE"; do
  [ -s "$source_file" ] || fail "required canonical runtime source missing: $source_file"
done

[ -x "$NODE" ] || fail "Node runtime missing: $NODE"

"$NODE" --check "$LAUNCHER_SOURCE"
bash -n "$HELPER_SOURCE"

grep -Fq 'paths: [deployRoot],' "$LAUNCHER_SOURCE" ||
  fail "launcher does not resolve @next/env from deployed release"

if grep -Fq 'paths: [workRepo],' "$LAUNCHER_SOURCE"; then
  fail "launcher still resolves @next/env from OTG_WORK_REPO"
fi

grep -Fq 'loadEnvConfig(workRepo, false);' "$LAUNCHER_SOURCE" ||
  fail "launcher no longer loads TEST env files from OTG_WORK_REPO"

grep -Fq 'Wants=tailscaled.service' "$DROPIN_SOURCE" ||
  fail "Tailscale Wants dependency missing"

grep -Fq 'After=tailscaled.service' "$DROPIN_SOURCE" ||
  fail "Tailscale After dependency missing"

grep -Fq 'ExecStartPre=/usr/local/libexec/otg-wait-for-tailscale-ip.sh 100.75.162.64 tailscale0 120' "$DROPIN_SOURCE" ||
  fail "Tailscale readiness ExecStartPre contract missing"

mkdir -p "$BACKUP"

if [ -e "$LAUNCHER_TARGET" ]; then
  cp -a "$LAUNCHER_TARGET" "$BACKUP/launch.cjs.before"
else
  : > "$BACKUP/launch.cjs.absent"
fi

if [ -e "$HELPER_TARGET" ]; then
  cp -a "$HELPER_TARGET" "$BACKUP/otg-wait-for-tailscale-ip.sh.before"
else
  : > "$BACKUP/otg-wait-for-tailscale-ip.sh.absent"
fi

if [ -e "$DROPIN_TARGET" ]; then
  cp -a "$DROPIN_TARGET" "$BACKUP/95-tailscale-ready.conf.before"
else
  : > "$BACKUP/95-tailscale-ready.conf.absent"
fi

cat > "$BACKUP/rollback.sh" <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail

BACKUP="$BACKUP"

if [ -f "\$BACKUP/launch.cjs.before" ]; then
  install -D -m 0700 "\$BACKUP/launch.cjs.before" "$LAUNCHER_TARGET"
else
  rm -f "$LAUNCHER_TARGET"
fi

if [ -f "\$BACKUP/otg-wait-for-tailscale-ip.sh.before" ]; then
  sudo install -D -m 0755 \
    "\$BACKUP/otg-wait-for-tailscale-ip.sh.before" \
    "$HELPER_TARGET"
else
  sudo rm -f "$HELPER_TARGET"
fi

if [ -f "\$BACKUP/95-tailscale-ready.conf.before" ]; then
  sudo install -D -m 0644 \
    "\$BACKUP/95-tailscale-ready.conf.before" \
    "$DROPIN_TARGET"
else
  sudo rm -f "$DROPIN_TARGET"
fi

sudo systemctl daemon-reload

echo "TEST runtime files restored."
echo "No service restarted."
ROLLBACK

chmod 700 "$BACKUP/rollback.sh"

sudo -v

install -d -m 0700 "$(dirname "$LAUNCHER_TARGET")"
install -m 0700 "$LAUNCHER_SOURCE" "$LAUNCHER_TARGET"

sudo install -D -m 0755 \
  "$HELPER_SOURCE" \
  "$HELPER_TARGET"

sudo install -D -m 0644 \
  "$DROPIN_SOURCE" \
  "$DROPIN_TARGET"

sudo systemctl daemon-reload
sudo systemd-analyze verify otg-test.service >/dev/null

"$NODE" --check "$LAUNCHER_TARGET"
bash -n "$HELPER_TARGET"

systemctl show otg-test.service \
  -p ExecStartPre \
  -p Wants \
  -p After \
  --no-pager

echo
echo "OK: canonical TEST launcher and Tailscale readiness files installed."
echo "Backup: $BACKUP"
echo "Rollback: $BACKUP/rollback.sh"
echo
echo "No service restarted."
echo "No release activated."
echo "No PROD mutation."
