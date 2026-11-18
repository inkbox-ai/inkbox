#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi

exec node "$SCRIPT_DIR/publish.mjs" "$@"
