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
  # identity delete cascades to the linked mailbox + tunnel
  inkbox identity delete "$HANDLE" 2>/dev/null || true
  echo "   Done."
}
trap cleanup EXIT

# --- workflow ---
echo "=> Creating identity: $HANDLE (mailbox + tunnel provisioned atomically)"
inkbox identity create "$HANDLE"

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

echo ""
echo "=> Mailbox storage headroom"
# `mailbox list` has a humanized `storage` column (used / cap, binary GiB).
# Sends past the cap fail with HTTP 402 — free space with `inkbox email delete
# <message-id> -i <handle>` / `inkbox email delete-thread <thread-id> -i
# <handle>`, or upgrade the plan.
inkbox mailbox list

# The same inbox can be attached to a regular mail client (Thunderbird, Apple
# Mail, mutt, ...) — no new credential: username = the inbox address, password =
# an identity-scoped API key. Print the IMAP/SMTP settings with:
#   inkbox mailbox client-settings "${HANDLE}@inkboxmail.com"
# The hosts are derived from the configured API base URL. If that URL isn't a
# recognized Inkbox API host, the command errors out rather than guess.
# https://inkbox.ai/docs/capabilities/email/mail-clients

# cleanup runs via trap
