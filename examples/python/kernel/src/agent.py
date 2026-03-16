"""
kernel/src/agent.py

Orchestrates browser setup and the tool-use agent loop.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING

from kernel import Kernel

from src.config import Config
from src.llm import LLMClient
from src.tools import TOOLS, ToolExecutor

if TYPE_CHECKING:
    from inkbox.agent_identity import AgentIdentity

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 25

SKILL_PATH = Path(__file__).resolve().parent.parent / "SKILL.md"


def run_agent(
    task: str,
    provider: str,
    model: str | None,
    identity: AgentIdentity,
    cleanup_identity: bool = True,
) -> None:
    """
    Run the agent loop: set up a browser, then execute tools until the task is complete.

    Args:
        task: Natural-language description of what the agent should accomplish.
        provider: LLM provider to use ("openai" or "anthropic").
        model: Optional model name override (e.g. "gpt-4o", "claude-sonnet-4-20250514").
        identity: The Inkbox agent identity to use.
        cleanup_identity: If True, delete the identity when the agent finishes.
    """
    kernel_client = Kernel(api_key=Config.KERNEL_API_KEY)

    email = identity.mailbox.email_address if identity.mailbox else "N/A"
    logger.info("%s | email: %s", identity.agent_handle, email)

    # create browser
    logger.info("Creating browser session...")
    browser = kernel_client.browsers.create(stealth=True)
    logger.info("Session %s", browser.session_id)
    if browser.browser_live_view_url:
        logger.info("Live view: %s", browser.browser_live_view_url)

    # build system prompt from SKILL.md (strip YAML frontmatter)
    skill_raw = SKILL_PATH.read_text()
    skill_body = re.sub(r"^---\n.*?^---\n", "", skill_raw, count=1, flags=re.DOTALL | re.MULTILINE).lstrip()
    system = skill_body.format(
        handle=identity.agent_handle,
        email=email,
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
            response = llm.follow_up(
                system=system,
                tool_defs=TOOLS,
                response=response,
                tool_results=results,
            )
        else:
            logger.warning("Reached max iterations, stopping.")

    finally:
        logger.info("Cleaning up browser session...")
        try:
            kernel_client.browsers.delete_by_id(browser.session_id)
        except Exception:
            pass
        if cleanup_identity:
            logger.info("Deleting agent identity '%s'...", identity.agent_handle)
            try:
                identity.delete()
            except Exception:
                pass
