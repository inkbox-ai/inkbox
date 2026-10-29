#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SDK_DIR="$REPO_ROOT/sdk/typescript"
cd "$SCRIPT_DIR"

DRY_RUN="--dry-run"
if [[ "${1:-}" == "--prod" ]]; then
  DRY_RUN=""
fi

# Load .env from repo root if present
ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

CLI_SDK_DEP="$(node -p "require('$REPO_ROOT/cli/package.json').dependencies['@inkbox/sdk']")"
SDK_VERSION="$(node -p "require('$REPO_ROOT/sdk/typescript/package.json').version")"
EXPECTED_CLI_SDK_DEP="^${SDK_VERSION}"

if [[ "$CLI_SDK_DEP" != "$EXPECTED_CLI_SDK_DEP" ]]; then
  echo "Error: cli/package.json depends on @inkbox/sdk@$CLI_SDK_DEP, but sdk/typescript/package.json is version $SDK_VERSION."
  echo "Expected cli/package.json to declare @inkbox/sdk as $EXPECTED_CLI_SDK_DEP before publishing."
  exit 1
fi

echo "==> Cleaning previous builds"
rm -rf dist/ "$SDK_DIR/dist/"

echo "==> Installing SDK dependencies"
npm ci --ignore-scripts --prefix "$SDK_DIR"

echo "==> Building SDK"
npm run build --prefix "$SDK_DIR"

echo "==> Installing dependencies"
npm ci --ignore-scripts

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
