"""
inkbox/vault/exceptions.py

Exception types raised by the vault module.
"""

from __future__ import annotations


class InkboxError(Exception):
    """Base exception for all Inkbox SDK errors."""


class InkboxAPIError(InkboxError):
    """Raised when the API returns a 4xx or 5xx response.

    Attributes:
        status_code: HTTP status code.
        detail: Error detail from the response body.
    """

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(f"HTTP {status_code}: {detail}")
        self.status_code = status_code
        self.detail = detail
