#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="--dry-run"
if [[ "${1:-}" == "--prod" ]]; then
  DRY_RUN=""
fi

# Load .env from repo root if present (e.g. CARGO_REGISTRY_TOKEN for crates.io)
ENV_FILE="$(dirname "$0")/../../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

echo "==> Cleaning previous builds"
rm -rf target/package

echo "==> Building"
cargo build --release

echo "==> Publishing"
cargo publish $DRY_RUN

echo ""
if [[ -n "$DRY_RUN" ]]; then
  echo "Dry run complete. Run with --prod to publish for real:"
  echo "  ./publish.sh --prod"
else
  echo "Done. Add to a project with:"
  echo "  cargo add inkbox"
fi
