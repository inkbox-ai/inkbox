"""
browser-use/src/config.py

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

    # env vars (required)
    INKBOX_API_KEY: str = os.environ.get("INKBOX_API_KEY", "")
    BROWSER_USE_API_KEY: str = os.environ.get("BROWSER_USE_API_KEY", "")

    # env vars (optional)
    INKBOX_VAULT_KEY: str = os.environ.get("INKBOX_VAULT_KEY", "")

    # hardcoded defaults
    BROWSER_MODEL: str = "bu-2-0"
    MAX_BROWSER_STEPS: int = 50

    @classmethod
    def validate(cls) -> None:
        """
        Ensure required API keys are present. Raises ValueError if not.
        """
        missing = [
            name for name in ("INKBOX_API_KEY", "BROWSER_USE_API_KEY")
            if not getattr(cls, name)
        ]
        if missing:
            raise ValueError(f"Missing required env vars: {', '.join(missing)}")
