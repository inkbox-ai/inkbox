"""
inkbox/exceptions.py

Canonical exception types for the Inkbox SDK.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID


class InkboxError(Exception):
    """
    Base exception for all Inkbox SDK errors.
    """


class InkboxVaultKeyError(InkboxError):
    """
    Raised when a vault key does not meet requirements.
    """


class InkboxAPIError(InkboxError):
    """
    Raised when the API returns a 4xx or 5xx response.

    Attributes:
        status_code: HTTP status code.
        detail: Error detail from the response body. May be a human-readable
            string, or a structured ``dict`` for errors that carry extra
            machine-readable fields (e.g. ``{"existing_rule_id": ..., ...}``).
    """

    def __init__(self, status_code: int, detail: str | dict[str, Any]) -> None:
        super().__init__(
            f"HTTP {status_code}: {detail}"
        )
        self.status_code = status_code
        self.detail: str | dict[str, Any] = detail


class DuplicateContactRuleError(InkboxAPIError):
    """
    Raised on 409 when creating a mail or phone contact rule that duplicates
    an existing (match_type, match_target) pair on the same resource.

    Attributes:
        existing_rule_id: UUID of the already-existing rule.
        detail: The full structured detail dict from the server.
    """

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.existing_rule_id: UUID = UUID(str(detail["existing_rule_id"]))


class RedundantContactAccessGrantError(InkboxAPIError):
    """
    Raised on 409 when posting a contact-access grant that is redundant
    under the current access model (e.g. adding a per-identity grant on
    top of an active wildcard).

    Attributes:
        error: Discriminator string from the server (``"redundant_grant"``).
        detail_message: Human-readable explanation from the server's
            ``detail`` field.
        detail: The full structured detail dict from the server.
    """

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.error: str = str(detail.get("error", "redundant_grant"))
        self.detail_message: str = str(detail.get("detail", ""))


class RecipientBlockedError(InkboxAPIError):
    """
    Raised on 403 when an SMS or call destination is blocked by an
    outbound contact rule on the sender (or by the sender's
    ``filter_mode`` default).

    Attributes:
        matched_rule_id: UUID of the rule that blocked the recipient, or
            ``None`` when no specific rule matched (i.e. the block came
            from the phone number's ``filter_mode`` default).
        address: The blocked counterparty (E.164 phone number).
        reason: Human-readable explanation from the server.
        detail: The full structured detail dict from the server.
    """

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        super().__init__(status_code=status_code, detail=detail)
        raw_rule = detail.get("matched_rule_id")
        self.matched_rule_id: UUID | None = UUID(str(raw_rule)) if raw_rule else None
        self.address: str = str(detail.get("address", ""))
        self.reason: str = str(detail.get("reason", ""))
