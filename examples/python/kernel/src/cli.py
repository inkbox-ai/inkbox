"""
kernel/src/cli.py

CLI entry point for running the agent.
"""

from __future__ import annotations

import argparse
import logging
import sys

from inkbox import Inkbox

from src.agent import run_agent
from src.config import Config
from src.identity import select_or_create_identity

logger = logging.getLogger(__name__)


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
        "--provider",
        choices=["openai", "anthropic"],
        default="openai",
        help="LLM provider (default: openai)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model name override",
    )
    args = parser.parse_args()

    try:
        Config.validate()
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)

    inkbox_client = Inkbox(api_key=Config.INKBOX_API_KEY)
    identity, is_new = select_or_create_identity(inkbox_client)

    run_agent(
        task=args.task,
        provider=args.provider,
        model=args.model,
        identity=identity,
        cleanup_identity=is_new,
    )


if __name__ == "__main__":
    main()
