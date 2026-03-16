# inkbox-kernel

Inkbox integration with [Kernel](https://www.kernel.sh) browsers.

Give your agent an email and browser. Everything it needs to use the internet like you do.

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
uv run inkbox-kernel "Go to news.ycombinator.com, read the top 3 posts, and email me a summary at alex@example.com"
```

## Usage

```bash
# using OpenAI (default)
uv run inkbox-kernel "Sign up for a free account on example.com using my email"

# using Anthropic
uv run inkbox-kernel --provider anthropic "Find the pricing page on example.com and email me a summary"
```

## What happens

1. The agent creates a fresh identity with a real email address via [Inkbox](https://inkbox.ai)
2. A cloud browser session spins up via [Kernel](https://kernel.sh)
3. The LLM uses tools (browse, email) to accomplish your task
4. Identity and browser are cleaned up when done

## Tools

| Category | Tool | Description |
|----------|------|-------------|
| Browser | `navigate` | Go to a URL |
| Browser | `get_page_text` | Read visible page content |
| Browser | `click_element` | Click by CSS selector |
| Browser | `fill_input` | Fill a form field |
| Browser | `press_key` | Press a key (Enter, Tab, etc.) |
| Browser | `execute_js` | Run arbitrary JavaScript |
| Email | `send_email` | Send or reply to an email |
| Email | `check_inbox` | List recent emails |
| Email | `read_email` | Read a specific email |

## API Keys

| Service | Get your key |
|---------|-------------|
| Inkbox | [console.inkbox.ai](https://console.inkbox.ai) |
| Kernel | [kernel.sh](https://kernel.sh) |
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
