#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="--dry-run"
if [[ "${1:-}" == "--prod" ]]; then
  DRY_RUN=""
fi

# Load .env from repo root if present
ENV_FILE="$(dirname "$0")/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

echo "==> Cleaning previous builds"
rm -rf dist/

echo "==> Installing dependencies"
npm install --ignore-scripts

echo "==> Building"
npm run build

echo "==> Publishing"
npm publish $DRY_RUN --access public

echo ""
if [[ -n "$DRY_RUN" ]]; then
  echo "Dry run complete. Run with --prod to publish for real:"
  echo "  ./publish.sh --prod"
else
  echo "Done. Install with:"
  echo "  npm install -g @inkbox/cli"
fi
