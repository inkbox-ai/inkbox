#!/usr/bin/env bash
set -euo pipefail

REPO="testpypi"
if [[ "${1:-}" == "--prod" ]]; then
  REPO="pypi"
fi

# Load .env from repo root if present
ENV_FILE="$(dirname "$0")/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
  export TWINE_USERNAME="__token__"
fi

echo "==> Cleaning previous builds"
rm -rf dist/ build/ *.egg-info

echo "==> Building"
uv build

echo "==> Uploading to $REPO"
if [[ "$REPO" == "testpypi" ]]; then
  REPO_URL="https://test.pypi.org/legacy/"
else
  REPO_URL="https://upload.pypi.org/legacy/"
fi
uv run --with twine twine upload --repository-url "$REPO_URL" dist/*

echo ""
if [[ "$REPO" == "testpypi" ]]; then
  echo "Done. Install with:"
  echo "  pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ inkbox"
else
  echo "Done. Install with:"
  echo "  pip install inkbox"
fi
