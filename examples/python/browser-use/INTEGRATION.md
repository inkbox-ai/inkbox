# Inkbox + Browser Use Integration Guide

How to add Inkbox email tools to a Browser Use agent.

## 1. Set up identity

```python
from inkbox import Inkbox

inkbox_client = Inkbox(api_key="...")
identity = inkbox_client.create_identity("my-agent")
identity.create_mailbox(display_name="My Agent")
# identity.mailbox.email_address → e.g. "abc123@inkboxmail.com"
```

## 2. Register email tools on a Controller

```python
from browser_use import ActionResult, Controller

controller = Controller()

# Register each Inkbox email action on the controller with a Pydantic param model.
# Tools use asyncio.to_thread() to call the synchronous Inkbox SDK from async context.
# See src/tools.py for the full implementation with all 6 email tools.

@controller.registry.action("Send an email", param_model=SendEmailArgs)
async def send_email(params):
    sent = await asyncio.to_thread(identity.send_email, to=params.to, subject=params.subject, body_text=params.body_text)
    return ActionResult(extracted_content=f"Email sent. ID: {sent.id}")
```

## 3. Run the agent

```python
from browser_use import Agent, BrowserSession, ChatBrowserUse

browser_session = BrowserSession(cdp_url="http://127.0.0.1:9222", keep_alive=True)
await browser_session.start()

agent = Agent(
    task=task,
    llm=ChatBrowserUse(model="bu-2-0", api_key="..."),
    browser_session=browser_session,
    controller=controller,          # ← controller with Inkbox tools
    use_vision=True,
    extend_system_message="...",    # ← system prompt with identity info
)

history = await agent.run(max_steps=50)
```

## Architecture

```
src/
├── cli.py        # argparse CLI → config validation → identity selection → run_agent()
├── config.py     # Config class: env vars (INKBOX_API_KEY, BROWSER_USE_API_KEY)
├── identity.py   # Interactive identity picker (questionary) or auto-create
├── agent.py      # Loads SKILL.md system prompt, sets up BrowserSession + Agent, runs loop
├── tools.py      # Inkbox email tools registered on a Browser Use Controller
└── chrome.py     # Auto-detect, launch, and verify Chrome in debug mode
```

## Key patterns

- **Tool registration**: Email tools are registered on a Browser Use `Controller` via `@controller.registry.action()` with Pydantic param models. The controller is passed to the `Agent`.
- **System prompt**: Loaded from `SKILL.md` at runtime. YAML frontmatter is stripped, then `{handle}` and `{email}` are interpolated with the agent's identity.
- **Async bridge**: The Inkbox SDK is synchronous. Tools use `asyncio.to_thread()` to call SDK methods from async Browser Use context.
- **Identity lifecycle**: On startup, the user picks an existing identity or creates a new one (with auto-provisioned mailbox). The identity is passed to the tool builder and agent.
- **Chrome management**: When using `--env local`, Chrome is auto-detected and launched if needed. On exit (without `--keep-browser`), Chrome is terminated if it was auto-launched.
