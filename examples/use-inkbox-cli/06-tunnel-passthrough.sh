#!/usr/bin/env bash
set -euo pipefail

# Passthrough-mode tunnel workflow.
#
# Creates an agent identity with `tls_mode=passthrough` (the tunnel's
# TLS mode is fixed at create time), generates a CSR keyed to the
# tunnel's public host, and asks the Inkbox control plane to sign it.
# The signed cert is what your local TLS terminator presents on
# inbound connections.

HANDLE="cli-tunnel-pt-demo"
WORKDIR=$(mktemp -d)
KEY="$WORKDIR/key.pem"
CSR="$WORKDIR/req.csr"
CERT="$WORKDIR/cert_chain.pem"

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required"; exit 1; }

# --- cleanup on exit ---
cleanup() {
  echo ""
  echo "=> Cleaning up..."
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  rm -rf "$WORKDIR"
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Creating identity '$HANDLE' with tls_mode=passthrough"
CREATE_JSON=$(inkbox --json identity create "$HANDLE" \
  --tls-mode passthrough)
TUNNEL_ID=$(echo "$CREATE_JSON" | jq -r '.tunnel.id')
PUBLIC_HOST=$(echo "$CREATE_JSON" | jq -r '.tunnel.publicHost')
STATUS=$(echo "$CREATE_JSON" | jq -r '.tunnel.status')

echo "   tunnel_id   : $TUNNEL_ID"
echo "   public_host : $PUBLIC_HOST"
echo "   status      : $STATUS  (transitions to active after CSR sign)"

echo ""
echo "=> Generating a private key + CSR for $PUBLIC_HOST"
openssl req -new -newkey ec:<(openssl ecparam -name prime256v1) \
  -nodes -keyout "$KEY" -out "$CSR" \
  -subj "/CN=$PUBLIC_HOST" >/dev/null 2>&1

echo "=> Submitting CSR to inkbox tunnel sign-csr (server runs DNS + cert issuance synchronously)"
inkbox tunnel sign-csr "$TUNNEL_ID" --csr "$CSR" --out "$CERT" \
  | tee "$WORKDIR/sign-csr-result.json"
echo ""
echo "   signed cert chain written to: $CERT"

echo ""
echo "=> Refreshed tunnel status"
inkbox --json tunnel get "$HANDLE" | jq '{id, publicHost, tlsMode, status}'

echo ""
echo "=> Done. The agent process should load $KEY + $CERT and start"
echo "   inkbox.tunnels.connect(name=\"$HANDLE\", forward_to=...) to bring it online."
