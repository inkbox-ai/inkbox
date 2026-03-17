---
name: inkbox-browser-use
description: Integration guide for adding Inkbox email capabilities to a Browser Use agent. Use this when setting up an AI agent that needs both browser automation (via Browser Use) and real email (via Inkbox). Covers the full pattern — identity setup, tool registration on a Controller, system prompt, and agent run loop.
---

# Inkbox + Browser Use Integration

This example gives a Browser Use agent a real email address via Inkbox. The agent can browse the web AND send/receive email — enabling sign-up flows, email verification, and communication tasks.

## How it works

1. An Inkbox identity is created (or selected) with a real email mailbox
2. Inkbox email tools are registered as custom actions on a Browser Use `Controller`
3. The Controller is passed to the Browser Use `Agent` alongside a system prompt that tells the agent about its email capabilities
4. The agent runs with both browser and email tools available

## Key integration points

### Identity setup

```python
from inkbox import Inkbox

client = Inkbox(api_key="...")
identity = client.create_identity("my-agent")
identity.create_mailbox(display_name="My Agent")
# identity.mailbox.email_address → "abc123@inkboxmail.com"
```

### Registering email tools on a Controller (tools.py)

Each Inkbox email action is registered on a Browser Use `Controller` using `@controller.registry.action()` with a Pydantic param model. The Inkbox SDK is synchronous, so tools use `asyncio.to_thread()` to bridge into Browser Use's async context.

```python
from browser_use import ActionResult, Controller

controller = Controller()

@controller.registry.action("Send an email", param_model=SendEmailArgs)
async def send_email(params):
    sent = await asyncio.to_thread(
        identity.send_email,
        to=params.to,
        subject=params.subject,
        body_text=params.body_text,
    )
    return ActionResult(extracted_content=f"Email sent. ID: {sent.id}")
```

The 6 email tools registered:
- `send_email` — send or reply (supports CC, BCC, HTML body, threading via in_reply_to)
- `list_emails` — list recent emails, filter by inbound/outbound
- `check_unread_emails` — list unread emails only
- `mark_emails_read` — mark messages as read by ID
- `read_email` — read full email (body text, HTML, headers)
- `get_thread` — get full thread by thread ID

### Wiring it together (agent.py)

```python
from browser_use import Agent, BrowserSession, ChatBrowserUse

controller = build_controller(inkbox_client, identity)

browser_session = BrowserSession(cdp_url="http://127.0.0.1:9222")
await browser_session.start()

agent = Agent(
    task=task,
    llm=ChatBrowserUse(model="bu-2-0", api_key="..."),
    browser_session=browser_session,
    controller=controller,
    use_vision=True,
    extend_system_message=system_message,
)

history = await agent.run(max_steps=50)
```

The system prompt is defined inline in `agent.py` and tells the agent its handle, email address, available tools, and guidelines for using them.

## CLI usage

```bash
# local Chrome (auto-launches if not running)
uv run inkbox-browser-use "Go to hacker news, get top 10 posts, and email them to alex@example.com"

# Browser Use Cloud
uv run inkbox-browser-use --env cloud "Sign up for a free account on example.com using my email"

# keep browser open after task
uv run inkbox-browser-use --keep-browser "Sign up for example.com and verify the email"
```

## Environment variables

Only two required in `.env`:
```
INKBOX_API_KEY=...
BROWSER_USE_API_KEY=...
```
