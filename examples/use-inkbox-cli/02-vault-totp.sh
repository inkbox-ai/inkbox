#!/usr/bin/env bash
set -euo pipefail

# Vault TOTP workflow
# Creates a login credential with TOTP, generates one-time codes, then cleans up.
#
# Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
#   Email:    totp@authenticationtest.com
#   Password: pa$$w0rd
#   Secret:   I65VU7K5ZQL7WB4E

HANDLE="cli-vault-demo"
TOTP_URI="otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E"

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
: "${INKBOX_VAULT_KEY:?Set INKBOX_VAULT_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (https://jqlang.github.io/jq/)"; exit 1; }

# --- cleanup on exit ---
SECRET_ID=""
cleanup() {
  echo ""
  echo "=> Cleaning up..."
  if [ -n "$SECRET_ID" ]; then
    inkbox identity delete-secret "$HANDLE" "$SECRET_ID" 2>/dev/null || true
    echo "   Deleted secret $SECRET_ID"
  fi
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Checking vault status"
inkbox vault info

echo ""
echo "=> Creating identity: $HANDLE"
inkbox identity create "$HANDLE"

echo ""
echo "=> Creating login secret with TOTP"
SECRET_JSON=$(inkbox --json identity create-secret "$HANDLE" \
  --name "authenticationtest.com" \
  --type login \
  --username "totp@authenticationtest.com" \
  --password 'pa$$w0rd' \
  --url "https://authenticationtest.com/totpChallenge/" \
  --totp-uri "$TOTP_URI")
SECRET_ID=$(echo "$SECRET_JSON" | jq -r '.id')
echo "   Created secret: $SECRET_ID"

echo ""
echo "=> Listing login credentials for $HANDLE"
inkbox --json vault logins -i "$HANDLE" | jq '.[] | {name, username: .payload.username, has_totp: (.payload.totp != null)}'

echo ""
echo "=> Generating TOTP codes"
for i in 1 2 3; do
  inkbox --json identity totp-code "$HANDLE" "$SECRET_ID" | jq '{code, seconds_remaining}'
  [ "$i" -lt 3 ] && sleep 5
done

# cleanup runs via trap
