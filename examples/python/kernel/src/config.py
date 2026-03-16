"""
kernel/src/config.py

Centralized configuration loaded from environment variables.
"""

import logging
import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    """
    Runtime configuration loaded from environment variables.
    """

    LOG_LEVEL: int = getattr(
        logging,
        os.environ.get("LOG_LEVEL", "INFO").upper(),
        logging.INFO,
    )

    # env vars

    INKBOX_API_KEY: str = os.environ.get("INKBOX_API_KEY", "")
    KERNEL_API_KEY: str = os.environ.get("KERNEL_API_KEY", "")

    OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")

    # default models
    DEFAULT_OPENAI_MODEL: str = "gpt-4o"
    DEFAULT_ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    @classmethod
    def validate(cls) -> None:
        """
        Ensure required API keys are present. Raises ValueError if not.
        """
        missing = [
            name for name in ("INKBOX_API_KEY", "KERNEL_API_KEY")
            if not getattr(cls, name)
        ]
        if missing:
            raise ValueError(f"Missing required env vars: {', '.join(missing)}")

        if not cls.OPENAI_API_KEY and not cls.ANTHROPIC_API_KEY:
            raise ValueError(
                "At least one LLM key required: OPENAI_API_KEY or ANTHROPIC_API_KEY"
            )
