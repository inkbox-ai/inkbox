#!/usr/bin/env bash
set -euo pipefail

# Edge-mode tunnel workflow.
#
# Creates an agent identity (which atomically provisions the linked
# tunnel), mints an identity-scoped API key, and prints the public URL.
# This script does not actually start a tunnel agent — that's the job
# of `inkbox.tunnels.connect()` in a Python/TS process. See
# `skills/inkbox-tunnels/SKILL.md` for the agent-side runtime examples.

HANDLE="cli-tunnel-edge-demo"

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (https://jqlang.github.io/jq/)"; exit 1; }

# --- cleanup on exit ---
cleanup() {
  echo ""
  echo "=> Cleaning up..."
  # Identity-delete cascades to the linked mailbox + tunnel and revokes
  # any identity-scoped API keys.
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Creating identity '$HANDLE' (tls_mode=edge by default)"
CREATE_JSON=$(inkbox --json identity create "$HANDLE")
IDENTITY_ID=$(echo "$CREATE_JSON" | jq -r '.id')
PUBLIC_HOST=$(echo "$CREATE_JSON" | jq -r '.tunnel.publicHost')

echo "   identity_id : $IDENTITY_ID"
echo "   public_host : $PUBLIC_HOST"
echo "   public URL  : https://$PUBLIC_HOST"

echo ""
echo "=> Minting an identity-scoped API key for the agent process"
KEY_JSON=$(inkbox --json api-keys create \
  --label "$HANDLE agent" \
  --identity-id "$IDENTITY_ID")
SCOPED_KEY=$(echo "$KEY_JSON" | jq -r '.apiKey')
echo "   key      : ${SCOPED_KEY:0:12}…"

echo ""
echo "=> Tunnel record (from 'inkbox tunnel get')"
inkbox --json tunnel get "$HANDLE" | jq '{id, tunnelName, publicHost, zone, tlsMode, status}'

echo ""
echo "=> Done. To bring the tunnel online, run something like:"
echo ""
echo "     INKBOX_API_KEY='$SCOPED_KEY' python -c \\"
echo "       'from inkbox import Inkbox; Inkbox(api_key=\"'$SCOPED_KEY'\").tunnels.connect(name=\"$HANDLE\", forward_to=\"http://127.0.0.1:8080\").wait()'"
echo ""
echo "   …then curl https://$PUBLIC_HOST/ to hit your local server."
