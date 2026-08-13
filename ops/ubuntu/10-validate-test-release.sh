#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONTRACT_FILE=${OTG_TEST_CONTRACT_FILE:-$SCRIPT_DIR/test-release-payload.contract}
CURRENT_LINK=${OTG_TEST_CURRENT_LINK:-/home/shawn-rochford/AI/deploy/otg-test/current}
UNIT_DIR=${OTG_TEST_UNIT_DIR:-}
RELEASE_DIR=${1:-}

if [ -z "$RELEASE_DIR" ]; then
  echo "Usage: 10-validate-test-release.sh <release-directory>" >&2
  exit 2
fi
if [ ! -d "$RELEASE_DIR" ]; then
  echo "FAIL: release directory not found: $RELEASE_DIR" >&2
  exit 1
fi
if [ ! -r "$CONTRACT_FILE" ]; then
  echo "FAIL: payload contract not readable: $CONTRACT_FILE" >&2
  exit 1
fi

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

while IFS= read -r contract_line || [ -n "$contract_line" ]; do
  case "$contract_line" in
    ""|'#'*) continue ;;
  esac
  if [[ "$contract_line" != *$'\t'* ]]; then
    fail "invalid contract entry (expected type<TAB>path): $contract_line"
    continue
  fi
  kind=${contract_line%%$'\t'*}
  relative_path=${contract_line#*$'\t'}
  if [ -z "$relative_path" ] || [[ "$relative_path" == *$'\t'* ]] || [[ "$relative_path" = /* ]] ||
     [[ "/$relative_path/" == *"/../"* ]]; then
    fail "invalid release-relative contract path: $relative_path"
    continue
  fi
  case "$kind" in
    file)
      [ -s "$RELEASE_DIR/$relative_path" ] || fail "required nonempty file missing: $relative_path"
      ;;
    tree)
      if [ ! -d "$RELEASE_DIR/$relative_path" ]; then
        fail "required directory missing: $relative_path"
      elif ! find "$RELEASE_DIR/$relative_path" -type f -print -quit | grep -q .; then
        fail "required directory contains no files: $relative_path"
      fi
      ;;
    *) fail "unknown contract entry type '$kind' for $relative_path" ;;
  esac
done < "$CONTRACT_FILE"

unit_files=()
if [ -n "$UNIT_DIR" ]; then
  while IFS= read -r unit_file; do unit_files+=("$unit_file"); done < <(
    find "$UNIT_DIR" -maxdepth 1 -type f -name 'otg-character-*.service' -print | sort
  )
else
  while read -r unit_name _; do
    [ -n "$unit_name" ] || continue
    fragment=$(systemctl show "$unit_name" -p FragmentPath --value)
    [ -n "$fragment" ] && unit_files+=("$fragment")
  done < <(systemctl list-unit-files 'otg-character-*.service' --state=enabled --no-legend)
fi

worker_relatives=()
for unit_file in "${unit_files[@]}"; do
  [ -r "$unit_file" ] || { fail "enabled worker unit is unreadable: $unit_file"; continue; }
  while IFS= read -r referenced_path; do
    relative_path=${referenced_path#"$CURRENT_LINK"/}
    worker_relatives+=("$relative_path")
  done < <(
    sed -n 's/^ExecStart=//p' "$unit_file" |
      grep -oE "$CURRENT_LINK/scripts/linux/[A-Za-z0-9._-]+\.py" || true
  )
done

if [ "${#worker_relatives[@]}" -eq 0 ]; then
  fail "no enabled TEST Character worker executable was derived from systemd"
fi

# Validate systemd entrypoints, then follow release-local Python dependencies
# embedded in those workers (for example the Qwen and Cosy bridge defaults).
dependency_queue=("${worker_relatives[@]}")
checked=()
while [ "${#dependency_queue[@]}" -gt 0 ]; do
  relative_path=${dependency_queue[0]}
  dependency_queue=("${dependency_queue[@]:1}")
  already_checked=0
  for checked_path in "${checked[@]:-}"; do
    [ "$checked_path" = "$relative_path" ] && already_checked=1
  done
  [ "$already_checked" -eq 0 ] || continue
  checked+=("$relative_path")

  worker_path="$RELEASE_DIR/$relative_path"
  if [ ! -s "$worker_path" ]; then
    fail "systemd-referenced worker executable missing: $relative_path"
    continue
  fi

  while IFS= read -r dependency_path; do
    dependency_relative=${dependency_path#"$CURRENT_LINK"/}
    dependency_queue+=("$dependency_relative")
  done < <(
    grep -oE "$CURRENT_LINK/scripts/linux/[A-Za-z0-9._-]+\.py" "$worker_path" || true
  )
done

if [ "$failures" -ne 0 ]; then
  echo "REJECTED: $RELEASE_DIR ($failures contract failure(s))" >&2
  exit 1
fi

echo "OK: TEST release payload accepted: $RELEASE_DIR"
echo "OK: derived and validated ${#worker_relatives[@]} enabled systemd worker executable(s)"
