"""
browser-use/src/cli.py

CLI entry point for running the agent.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from inkbox import Inkbox

from src.agent import run_agent
from src.config import Config
from src.identity import select_or_create_identity

logger = logging.getLogger(__name__)

DEFAULT_CHROME_DEBUG_URL = "http://127.0.0.1:9222"


def main() -> None:
    """Parse CLI arguments, configure logging, and launch the agent."""
    logging.basicConfig(level=Config.LOG_LEVEL, format="%(message)s")

    parser = argparse.ArgumentParser(
        description="AI agent with a browser and email.",
    )

    parser.add_argument(
        "task",
        help="What you want the agent to accomplish",
    )
    parser.add_argument(
        "--env",
        choices=["local", "cloud"],
        default="local",
        help="Browser environment (default: local)",
    )
    parser.add_argument(
        "--chrome-debug-url",
        default=DEFAULT_CHROME_DEBUG_URL,
        help=f"Chrome remote debugging URL (default: {DEFAULT_CHROME_DEBUG_URL}). Required when --env=local.",
    )
    parser.add_argument(
        "--keep-browser",
        action="store_true",
        default=False,
        help="Keep the browser tab open after the task completes. Also prevents killing Chrome if it was auto-launched.",
    )
    args = parser.parse_args()

    try:
        Config.validate()
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)

    inkbox_client = Inkbox(api_key=Config.INKBOX_API_KEY)

    if Config.INKBOX_VAULT_KEY:
        inkbox_client.vault.unlock(Config.INKBOX_VAULT_KEY)
        logger.info("Vault unlocked")

    identity, _ = select_or_create_identity(inkbox_client)

    asyncio.run(
        run_agent(
            task=args.task,
            identity=identity,
            inkbox_client=inkbox_client,
            use_cloud=args.env == "cloud",
            chrome_debug_url=args.chrome_debug_url,
            keep_browser=args.keep_browser,
        )
    )


if __name__ == "__main__":
    main()
