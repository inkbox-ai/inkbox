"""Support Agent instructions included with API errors."""

from __future__ import annotations

from typing import Any


def parse_agent_support(value: Any) -> str | None:
    """Return non-empty support instructions and ignore malformed values."""
    return value if isinstance(value, str) and value else None
