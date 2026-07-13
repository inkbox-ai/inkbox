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
    Raised on 409 when creating a mail, phone, or iMessage contact rule that
    duplicates an existing (match_type, match_target) pair on the same
    resource.

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


class StorageLimitExceededError(InkboxAPIError):
    """
    Raised on 402 when an outbound send would push a mailbox past its plan's
    storage cap. Raised by ``messages.send``, ``messages.reply_all``, and
    ``messages.forward``.

    Free space by deleting messages (``messages.delete``) or whole threads
    (``threads.delete``) — reclaim is immediate — or upgrade the plan.

    Attributes:
        message: Human-readable explanation from the server.
        upgrade_url: Console billing page to raise the cap.
        limit_bytes: The cap that was hit, in bytes. Binary units — divide by
            1024 and label GiB/MiB.
        detail: The full structured detail dict from the server.
    """

    def __init__(self, status_code: int, detail: dict[str, Any]) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.message: str = str(detail.get("message", ""))
        self.upgrade_url: str = str(detail.get("upgrade_url", ""))
        raw_limit = detail.get("limit_bytes")
        self.limit_bytes: int | None = int(raw_limit) if raw_limit is not None else None


class RecipientBlockedError(InkboxAPIError):
    """
    Raised on 403 when an SMS, call, or iMessage destination is blocked
    by an outbound contact rule on the sender (or by the sender's
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
