"""
browser-use/src/agent.py

Orchestrates Browser Use agent setup and the run loop.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
from typing import TYPE_CHECKING

from browser_use import Agent, BrowserSession, ChatBrowserUse

from src.chrome import ensure_chrome_running
from src.config import Config
from src.tools import build_controller

if TYPE_CHECKING:
    from inkbox import Inkbox
    from inkbox.agent_identity import AgentIdentity

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an AI agent with a live browser and a real email address.

Your identity:
- Handle: {handle}
- Email: {email}
- You fully own and control this email address. You can send, receive, read, and reply to all emails.
- You can use this email to sign up for services, verify accounts, and complete any email-based authentication flow.

Browser (via Browser Use):
- Browser Use handles navigation, clicking, form filling, and page reading automatically.
- You have full vision — you can see screenshots of the page.

Email tools (via Inkbox):
- send_email(to, subject, body_text, ...) — send or reply to an email
- list_emails(direction?, limit?) — list recent emails
- check_unread_emails(limit?) — list unread emails only
- mark_emails_read(message_ids) — mark specific emails as read
- read_email(message_id) — read a specific email in full
- get_thread(thread_id) — retrieve a full email thread

Guidelines:
- Think step by step.
- Use the browser to navigate, read, and interact with websites.
- Use email to communicate — you can send, receive, and reply.
- When signing up for a service, use YOUR email address. It's real and you control it.
- When a service sends a verification email, use check_unread_emails then read_email to get the code or link.
- When done, respond with a summary of what you accomplished.
"""


async def run_agent(
    task: str,
    identity: AgentIdentity,
    inkbox_client: Inkbox,
    use_cloud: bool = False,
    chrome_debug_url: str = "http://127.0.0.1:9222",
    keep_browser: bool = False,
) -> None:
    """
    Run the Browser Use agent with Inkbox email tools.

    Args:
        task: Natural-language description of what the agent should accomplish.
        identity: The Inkbox agent identity to use.
        inkbox_client: Authenticated Inkbox client.
        use_cloud: If True, use Browser Use Cloud instead of local Chrome.
        chrome_debug_url: Chrome remote debugging URL (used when use_cloud=False).
        keep_browser: If True, don't close the browser tab or kill Chrome on exit.
    """
    email = identity.mailbox.email_address if identity.mailbox else "N/A"
    logger.info("%s | email: %s", identity.agent_handle, email)

    system_message = SYSTEM_PROMPT.format(
        handle=identity.agent_handle,
        email=email,
    )

    # set up controller with email tools
    controller = build_controller(inkbox_client, identity)

    # set up browser session
    chrome_process: subprocess.Popen | None = None
    if use_cloud:
        logger.info("Using Browser Use Cloud")
        browser_session = BrowserSession(use_cloud=True, keep_alive=keep_browser)
    else:
        chrome_process = ensure_chrome_running(chrome_debug_url)
        logger.info("Connecting to local Chrome at %s", chrome_debug_url)
        browser_session = BrowserSession(
            cdp_url=chrome_debug_url,
            keep_alive=keep_browser,
        )

    try:
        await browser_session.start()
        logger.info("Browser session started")

        llm = ChatBrowserUse(
            model=Config.BROWSER_MODEL,
            api_key=Config.BROWSER_USE_API_KEY,
        )

        agent = Agent(
            task=task,
            llm=llm,
            browser_session=browser_session,
            controller=controller,
            use_vision=True,
            include_tool_call_examples=True,
            _url_shortening_limit=2000,
            extend_system_message=system_message,
        )

        logger.info("Task: %s", task)
        history = await agent.run(max_steps=Config.MAX_BROWSER_STEPS)

        final_result = history.final_result()
        if final_result:
            logger.info("[result] %s", final_result)
        elif history.has_errors():
            errors = [e for e in history.errors() if e]
            logger.error("[error] %s", errors[-1] if errors else "unknown error")
        else:
            logger.info("[done] Task completed.")

    finally:
        if keep_browser:
            logger.info("--keep-browser: leaving browser open")
        else:
            logger.info("Cleaning up browser session...")
            try:
                await browser_session.stop()
            except Exception:
                pass
            # kill Chrome if we launched it
            if chrome_process is not None:
                logger.info("Terminating Chrome (launched by inkbox-browser-use)...")
                try:
                    chrome_process.terminate()
                    chrome_process.wait(timeout=5)
                except Exception:
                    try:
                        chrome_process.kill()
                    except Exception:
                        pass
        inkbox_client.close()
