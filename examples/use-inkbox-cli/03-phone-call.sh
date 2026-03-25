#!/usr/bin/env bash
set -euo pipefail

# Phone workflow
# Provisions a toll-free number, places a call, fetches the transcript, then releases the number.
#
# NOTE: Phone features require an active plan with phone access.

HANDLE="cli-phone-demo"
CALL_TO="${1:?Usage: $0 <e164-phone-number>  (e.g. +15551234567)}"

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (https://jqlang.github.io/jq/)"; exit 1; }

# --- cleanup on exit ---
NUMBER_ID=""
cleanup() {
  echo ""
  echo "=> Cleaning up..."
  if [ -n "$NUMBER_ID" ]; then
    inkbox number release "$NUMBER_ID" 2>/dev/null || true
    echo "   Released number $NUMBER_ID"
  fi
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Creating identity: $HANDLE"
inkbox identity create "$HANDLE"

echo ""
echo "=> Provisioning a toll-free number"
NUMBER_JSON=$(inkbox --json number provision --handle "$HANDLE" --type toll_free)
NUMBER_ID=$(echo "$NUMBER_JSON" | jq -r '.id')
PHONE_NUMBER=$(echo "$NUMBER_JSON" | jq -r '.phone_number // .phoneNumber // "unknown"')
echo "   Provisioned: $PHONE_NUMBER (id: $NUMBER_ID)"

echo ""
echo "=> Placing call to $CALL_TO"
CALL_JSON=$(inkbox --json phone call -i "$HANDLE" --to "$CALL_TO")
CALL_ID=$(echo "$CALL_JSON" | jq -r '.id // .call_id // .callId')
echo "   Call ID: $CALL_ID"

echo ""
echo "=> Waiting for call to complete..."
sleep 15

echo ""
echo "=> Listing recent calls"
inkbox --json phone calls -i "$HANDLE" --limit 5 | jq '.[] | {id, to, status, duration}'

echo ""
echo "=> Fetching transcript for call $CALL_ID"
inkbox phone transcripts "$CALL_ID" -i "$HANDLE" || echo "   No transcript available yet."

# cleanup runs via trap
