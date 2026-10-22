#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 && $(hostname) == shawn ]] || { echo 'Run with sudo on shawn, the TEST web host.' >&2; exit 1; }
release=$(readlink -f /home/shawn-rochford/AI/deploy/otg-test/current)
[[ $release == /home/shawn-rochford/AI/deploy/otg-test/releases/test3001-* ]]
test -s "$release/server.js"
test -s "$release/.next/BUILD_ID"
test -e "$release/.env.local"
package_dir=$(cd -- "$(dirname -- "$0")" && pwd)
install -d -m 755 /etc/systemd/system/otg-test.service.d
install -m 644 "$package_dir/otg-test-managed.conf" /etc/systemd/system/otg-test.service.d/zzzzz-test-managed-node20.conf
systemctl daemon-reload
if ! systemctl is-active --quiet otg-test.service; then
  listener_pid=$(/usr/bin/ss -ltnp 'sport = :3001' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
  if [[ -n $listener_pid ]]; then
    listener_cwd=$(readlink -f "/proc/$listener_pid/cwd")
    [[ $listener_cwd == /home/shawn-rochford/AI/deploy/otg-test/releases/test3001-* ]] || { echo 'Unexpected port 3001 process; refusing.' >&2; exit 1; }
    kill -TERM "$listener_pid"
    for attempt in {1..100}; do kill -0 "$listener_pid" 2>/dev/null || break; sleep .1; done
    kill -0 "$listener_pid" 2>/dev/null && { echo 'TEST process did not exit; refusing restart.' >&2; exit 1; }
  fi
fi
systemctl enable otg-test.service
systemctl restart otg-test.service
for attempt in {1..60}; do
  if curl -fsS http://127.0.0.1:3001/api/healthz >/dev/null; then
    systemctl is-active otg-test.service
    systemctl show otg-test.service -p MainPID -p WorkingDirectory -p Restart -p UnitFileState
    exit 0
  fi
  sleep 1
done
echo 'TEST did not reach health. Inspect journalctl -u otg-test.service.' >&2
exit 1
