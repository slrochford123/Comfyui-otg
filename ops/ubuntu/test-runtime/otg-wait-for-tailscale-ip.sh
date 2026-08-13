#!/usr/bin/env bash
set -euo pipefail

IP="${1:-100.75.162.64}"
DEV="${2:-tailscale0}"
TIMEOUT="${3:-120}"

case "$TIMEOUT" in
    ''|*[!0-9]*)
        echo "Invalid timeout: $TIMEOUT" >&2
        exit 2
        ;;
esac

elapsed=0

while [ "$elapsed" -lt "$TIMEOUT" ]; do
    if /usr/sbin/ip -4 -o addr show dev "$DEV" 2>/dev/null |
       /usr/bin/grep -Fq " $IP/"; then
        echo "Tailscale address ready: $IP on $DEV"
        exit 0
    fi

    /usr/bin/sleep 1
    elapsed=$((elapsed + 1))
done

echo "Timed out after ${TIMEOUT}s waiting for $IP on $DEV" >&2
/usr/sbin/ip -brief address show "$DEV" 2>/dev/null >&2 || true

exit 1
