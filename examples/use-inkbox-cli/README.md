# use-inkbox-cli

Shell script examples showing how to automate Inkbox from the command line — useful for AI agents that execute shell commands, CI pipelines, and terminal workflows.

## Prerequisites

1. Node.js >= 18
2. An Inkbox API key (`INKBOX_API_KEY`) — get one at [inkbox.ai/console](https://inkbox.ai/console)
3. A vault key (`INKBOX_VAULT_KEY`) — only needed for vault/TOTP scripts; initialize from the console first
4. [`jq`](https://jqlang.github.io/jq/) — used to parse `--json` output

## Install the CLI

```bash
npm install -g @inkbox/cli
```

Or run directly with npx (replace `inkbox` with `npx @inkbox/cli` in the scripts).

## Scripts

| Script | What it does |
|--------|-------------|
| `01-identity-and-email.sh` | Create an identity, set up a mailbox, send and read emails, clean up |
| `02-vault-totp.sh` | Store a login credential with TOTP, generate one-time codes, clean up |
| `03-phone-call.sh` | Provision a number, place a call, fetch the transcript, release the number |
| `04-inbox-monitor.sh` | Poll for unread emails in a loop — demonstrates an ongoing automation pattern |

## Run

```bash
export INKBOX_API_KEY="ApiKey_..."
export INKBOX_VAULT_KEY="my-vault-key"  # only for 02-vault-totp.sh

./01-identity-and-email.sh
./02-vault-totp.sh
./03-phone-call.sh
./04-inbox-monitor.sh --interval 10 --max-checks 5
```

## Tips for automation

Use `--json` to get machine-readable output from any command:

```bash
# Extract the first message ID from the inbox
MSG_ID=$(inkbox --json email list -i my-agent --limit 1 | jq -r '.messages[0].id')

# Read that message
inkbox email get "$MSG_ID" -i my-agent
```

All scripts use this pattern to chain commands together.
