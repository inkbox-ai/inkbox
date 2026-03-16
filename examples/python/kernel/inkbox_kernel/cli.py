"""
inkbox_kernel/cli.py

CLI entry point for running the agent.
"""

from __future__ import annotations

import argparse
import logging

from inkbox_kernel.agent import run_agent
from inkbox_kernel.config import Config


def main() -> None:
    """Parse CLI arguments, configure logging, and launch the agent."""
    logging.basicConfig(level=Config.LOG_LEVEL, format="%(message)s")

    parser = argparse.ArgumentParser(
        description="AI agent with a browser, email, and phone.",
    )

    parser.add_argument("task", help="What you want the agent to accomplish")
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
    parser.add_argument(
        "--with-phone",
        action="store_true",
        help="Provision a phone number for the agent",
    )
    args = parser.parse_args()

    run_agent(
        task=args.task,
        provider=args.provider,
        model=args.model,
        with_phone=args.with_phone,
    )


if __name__ == "__main__":
    main()
