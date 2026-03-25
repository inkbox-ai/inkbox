#!/usr/bin/env bash
set -euo pipefail

# Identity & Email workflow
# Creates an identity, sets up a mailbox, sends an email, reads it back, then cleans up.

HANDLE="cli-email-demo"

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (https://jqlang.github.io/jq/)"; exit 1; }

# --- cleanup on exit ---
cleanup() {
  echo ""
  echo "=> Cleaning up..."
  inkbox mailbox delete "${HANDLE}@inkbox.ai" 2>/dev/null || true
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Creating identity: $HANDLE"
inkbox identity create "$HANDLE"

echo ""
echo "=> Creating mailbox for $HANDLE"
inkbox mailbox create --handle "$HANDLE"

echo ""
echo "=> Sending a test email"
inkbox email send -i "$HANDLE" \
  --to "${HANDLE}@inkbox.ai" \
  --subject "CLI demo" \
  --body-text "Hello from the Inkbox CLI!"

echo ""
echo "=> Listing emails (JSON)"
EMAILS_JSON=$(inkbox --json email list -i "$HANDLE" --limit 5)
echo "$EMAILS_JSON" | jq '.messages[] | {id, subject, from}'

echo ""
echo "=> Reading the first message"
MSG_ID=$(echo "$EMAILS_JSON" | jq -r '.messages[0].id')
if [ "$MSG_ID" != "null" ] && [ -n "$MSG_ID" ]; then
  inkbox email get "$MSG_ID" -i "$HANDLE"
else
  echo "   No messages found yet (delivery may take a moment)."
fi

echo ""
echo "=> Marking message as read"
if [ "$MSG_ID" != "null" ] && [ -n "$MSG_ID" ]; then
  inkbox email mark-read "$MSG_ID" -i "$HANDLE"
  echo "   Marked $MSG_ID as read."
fi

# cleanup runs via trap
