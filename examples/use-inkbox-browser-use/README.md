# inkbox-browser-use

Inkbox integration with [Browser Use](https://browser-use.com).

Give your `Browser Use` agent an email, phone number, and encrypted vault. Everything it needs to communicate and authenticate on the internet like you do.

## Setup

```bash
# install uv (if you don't have it)
curl -LsSf https://astral.sh/uv/install.sh | sh

# install dependencies
uv sync

# configure API keys
cp .env.example .env
# edit .env with your keys
```

## Quickstart

```bash
uv run inkbox-browser-use "Go to news.ycombinator.com, get the top 5 posts, and email a summary to john@example.com"
```

Chrome will be auto-launched in debug mode if it isn't already running.

## Usage

```bash
# local Chrome (default — auto-launches if not running)
uv run inkbox-browser-use "Go to hacker news, get the top 10 posts, and email them to john@example.com"

# sign up for a service using the agent's email
uv run inkbox-browser-use "Sign up for a free account on example.com using my email"

# Browser Use Cloud (no local Chrome needed)
uv run inkbox-browser-use --env cloud "Go to example.com/pricing, summarize the plans, and email it to john@example.com"

# keep the browser open after the task completes
uv run inkbox-browser-use --keep-browser "Sign up for a free account on example.com using my email"

# local Chrome with custom debug URL
uv run inkbox-browser-use --chrome-debug-url http://127.0.0.1:9333 "Email john@example.com with a summary of example.com"
```

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--env` | `local` | `local` (Chrome) or `cloud` (Browser Use Cloud) |
| `--chrome-debug-url` | `http://127.0.0.1:9222` | Chrome remote debugging URL (local mode only) |
| `--keep-browser` | off | Keep browser tab open after task; don't kill auto-launched Chrome |

## What happens

1. You pick (or create) an Inkbox identity with a real email address
2. Chrome launches automatically in debug mode (or connects to Browser Use Cloud)
3. The Browser Use agent runs your task with full browser + email capabilities
4. Browser and Chrome are cleaned up when done (unless `--keep-browser`)

## Architecture

```
src/
├── cli.py        # argparse CLI → config validation → identity selection → run_agent()
├── config.py     # Config class: env vars (INKBOX_API_KEY, BROWSER_USE_API_KEY, INKBOX_VAULT_KEY)
├── identity.py   # Interactive identity picker (questionary) or auto-create
├── agent.py      # Loads SKILL.md system prompt, sets up BrowserSession + Agent, runs loop
├── tools.py      # Inkbox email + vault tools registered on a Browser Use Controller
└── chrome.py     # Auto-detect, launch, and verify Chrome in debug mode
```

### How it works

The Browser Use agent handles browser automation (navigate, click, fill forms, extract data, vision) with a full Inkbox identity — the agent gets its own email address and can sign up for services, log in, send/receive email, and interact with the web as itself. Inkbox tools are registered as custom actions on the Browser Use `Controller`.

The system prompt is loaded from `SKILL.md` at runtime, with the agent's handle and email address interpolated, and appended to Browser Use's default system prompt via `extend_system_message`.

## Email tools

| Tool | Description |
|------|-------------|
| `send_email` | Send an email (with optional reply threading, CC, BCC, HTML body) |
| `list_emails` | List recent emails (filter by inbound/outbound) |
| `check_unread_emails` | List unread emails |
| `mark_emails_read` | Mark specific emails as read |
| `read_email` | Read a specific email in full (includes body text) |
| `get_thread` | Get a full email thread by thread ID |

## Vault tools

When `INKBOX_VAULT_KEY` is set, the agent can access stored credentials:

| Tool | Description |
|------|-------------|
| `list_credentials` | List credentials accessible to this identity (filter by login, api_key, key_pair, ssh_key) |
| `get_credential` | Fetch a specific credential by ID (returns decrypted username, password, etc.) |
| `get_totp_code` | Generate a TOTP (2FA) code for a login credential |

Browser actions (navigate, click, fill, extract, screenshot) are handled automatically by Browser Use.

## Local Chrome (Debug Mode)

When using `--env local` (the default), Chrome must be running with remote debugging enabled. The CLI will **auto-launch Chrome** if it isn't already running. If auto-launch fails, you'll get an error with the exact command to run.

To launch manually:

### macOS

```bash
mkdir -p $HOME/tmp/chrome

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/tmp/chrome" \
  --remote-allow-origins='*' \
  --no-first-run \
  --no-default-browser-check

# verify
curl http://127.0.0.1:9222/json/version
```

### Windows

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\tmp\chrome" | Out-Null

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (!(Test-Path $chrome)) {
  $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}

& $chrome `
  --remote-debugging-address=127.0.0.1 `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\tmp\chrome" `
  --remote-allow-origins=* `
  --no-first-run `
  --no-default-browser-check

# verify
(Invoke-WebRequest http://127.0.0.1:9222/json/version).Content
```

### Linux

```bash
mkdir -p $HOME/tmp/chrome

google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/tmp/chrome" \
  --remote-allow-origins='*' \
  --no-first-run \
  --no-default-browser-check

# verify
curl http://127.0.0.1:9222/json/version
```

## API Keys

| Variable | Required | Description | Get your key |
|----------|----------|-------------|-------------|
| `INKBOX_API_KEY` | Yes | Inkbox API key for identity + email | [inkbox.ai/console](https://inkbox.ai/console) |
| `BROWSER_USE_API_KEY` | Yes | Browser Use API key | [browser-use.com](https://browser-use.com) |
| `INKBOX_VAULT_KEY` | No | Vault key to unlock stored credentials and TOTP codes | Set in Inkbox console |
