"""
inkbox_kernel/agent.py

Orchestrates identity creation, browser setup, and the tool-use agent loop.
"""

from __future__ import annotations

import json
import logging
import sys
from textwrap import dedent

from inkbox import Inkbox
from kernel import Kernel

from inkbox_kernel.config import Config
from inkbox_kernel.identity import create_agent_identity
from inkbox_kernel.llm import LLMClient
from inkbox_kernel.tools import TOOLS, ToolExecutor

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 25

SYSTEM_PROMPT = dedent("""\
    You are an AI agent with real tools for browsing the web, sending/receiving email, and making phone calls.

    Your identity:
    - Handle: {handle}
    - Email: {email}
    - Phone: {phone}

    You have a live cloud browser session. Use your tools to accomplish the given task.
    Think step by step. When done, respond with a summary of what you accomplished.""")


def run_agent(
    task: str,
    provider: str,
    model: str | None,
    with_phone: bool,
) -> None:
    """
    Run the agent loop: create an identity and browser, then execute tools until the task is complete.

    Args:
        task: Natural-language description of what the agent should accomplish.
        provider: LLM provider to use ("openai" or "anthropic").
        model: Optional model name override (e.g. "gpt-4o", "claude-sonnet-4-20250514").
        with_phone: If True, provision a toll-free phone number for the agent.
    """
    # validate config
    try:
        Config.validate()
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)

    # init clients
    logger.debug("Initializing Inkbox and Kernel clients")
    inkbox_client = Inkbox(api_key=Config.INKBOX_API_KEY)
    kernel_client = Kernel(api_key=Config.KERNEL_API_KEY)

    # create identity
    logger.info("Creating agent identity...")
    identity = create_agent_identity(inkbox_client, with_phone=with_phone)
    email = identity.mailbox.email_address if identity.mailbox else "N/A"
    phone = identity.phone_number.number if identity.phone_number else "Not provisioned"
    logger.info("%s | email: %s | phone: %s", identity.agent_handle, email, phone)

    # create browser
    logger.info("Creating browser session...")
    browser = kernel_client.browsers.create(stealth=True)
    logger.info("Session %s", browser.session_id)
    if browser.browser_live_view_url:
        logger.info("Live view: %s", browser.browser_live_view_url)

    # build system prompt
    system = SYSTEM_PROMPT.format(
        handle=identity.agent_handle,
        email=email,
        phone=phone,
    )

    # set up executor and LLM
    logger.debug("Using provider=%s model=%s", provider, model)
    executor = ToolExecutor(kernel_client, browser.session_id, identity)
    llm = LLMClient(provider, model)

    try:
        # agent loop
        logger.info("Task: %s", task)
        response = llm.chat(system, task, TOOLS)

        for _ in range(MAX_ITERATIONS):
            if response.text:
                logger.info("[agent] %s", response.text)
            if not response.tool_calls:
                break

            # execute each tool call
            results: list[tuple[str, str]] = []
            for tc in response.tool_calls:
                logger.info("[tool] %s(%s)", tc.name, json.dumps(tc.arguments, ensure_ascii=False))
                result = executor.execute(tc.name, tc.arguments)
                display = result[:200] + "..." if len(result) > 200 else result
                logger.info("  -> %s", display)
                results.append((tc.id, result))

            logger.debug("Sending %d tool result(s) back to LLM", len(results))
            response = llm.follow_up(system, TOOLS, response, results)
        else:
            logger.warning("Reached max iterations, stopping.")

    finally:
        logger.info("Cleaning up browser session and agent identity...")
        try:
            kernel_client.browsers.delete_by_id(browser.session_id)
        except Exception:
            pass
        try:
            identity.delete()
        except Exception:
            pass
