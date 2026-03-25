#!/usr/bin/env bash
set -euo pipefail

# Inbox monitor
# Polls for unread emails at a regular interval — demonstrates an ongoing automation pattern.
#
# Usage: ./04-inbox-monitor.sh [--handle <handle>] [--interval <seconds>] [--max-checks <n>]

HANDLE="cli-monitor-demo"
INTERVAL=30
MAX_CHECKS=0  # 0 = unlimited

while [[ $# -gt 0 ]]; do
  case "$1" in
    --handle)    HANDLE="$2";     shift 2 ;;
    --interval)  INTERVAL="$2";   shift 2 ;;
    --max-checks) MAX_CHECKS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- preflight ---
: "${INKBOX_API_KEY:?Set INKBOX_API_KEY before running this script}"
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required (https://jqlang.github.io/jq/)"; exit 1; }

echo "Monitoring inbox for identity: $HANDLE"
echo "Interval: ${INTERVAL}s | Max checks: ${MAX_CHECKS:-unlimited}"
echo "Press Ctrl+C to stop."
echo ""

CHECK=0
while true; do
  CHECK=$((CHECK + 1))
  if [ "$MAX_CHECKS" -gt 0 ] && [ "$CHECK" -gt "$MAX_CHECKS" ]; then
    echo "Reached max checks ($MAX_CHECKS). Exiting."
    break
  fi

  echo "[check $CHECK] $(date +%H:%M:%S) — fetching unread emails..."
  UNREAD_JSON=$(inkbox --json email unread -i "$HANDLE" --limit 10 2>/dev/null || echo '{"messages":[]}')
  COUNT=$(echo "$UNREAD_JSON" | jq '.messages | length')

  if [ "$COUNT" -gt 0 ]; then
    echo "  Found $COUNT unread message(s):"
    echo "$UNREAD_JSON" | jq -r '.messages[] | "  - [\(.id)] \(.from // "unknown") — \(.subject // "(no subject)")"'

    # Read and mark each message
    IDS=$(echo "$UNREAD_JSON" | jq -r '.messages[].id')
    for MSG_ID in $IDS; do
      echo ""
      echo "  Reading message $MSG_ID:"
      inkbox --json email get "$MSG_ID" -i "$HANDLE" | jq '{from, subject, body_text: .body_text[0:200]}'
    done

    # Mark all as read
    # shellcheck disable=SC2086
    inkbox email mark-read $IDS -i "$HANDLE"
    echo "  Marked $COUNT message(s) as read."
  else
    echo "  No unread messages."
  fi

  echo ""
  sleep "$INTERVAL"
done
