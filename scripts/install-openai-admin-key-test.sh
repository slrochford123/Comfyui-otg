#!/usr/bin/env bash
set -euo pipefail
set +x
# Hidden input; no key in command arguments, no obsolete user-service restart.
exec /usr/bin/python3 "$(dirname -- "${BASH_SOURCE[0]}")/install-openai-admin-key-test.py"
