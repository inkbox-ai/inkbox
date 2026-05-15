"""
inkbox/identities/exceptions.py

Typed exceptions for the identities surface, plus re-exports from the
canonical ``inkbox.exceptions`` module for backward compatibility.
"""

from __future__ import annotations

from typing import Any, Literal

from inkbox.exceptions import InkboxAPIError, InkboxError

BlockingNamespace = Literal["identities", "tunnels", "mail", None]


class HandleUnavailableError(InkboxAPIError):
    """Raised on 409 from identity-create / identity-rename when the
    requested agent_handle collides with the unified global namespace.

    ``blocking_namespace`` reports which side rejected: ``"identities"``,
    ``"tunnels"``, or ``"mail"``. May be ``None`` if the server did not
    set the field (older deploys; treat as opaque).
    """

    def __init__(
        self,
        status_code: int,
        detail: Any,
        blocking_namespace: BlockingNamespace,
    ) -> None:
        super().__init__(status_code, detail)
        self.blocking_namespace = blocking_namespace


def _read_blocking_namespace(detail: Any) -> BlockingNamespace:
    if isinstance(detail, dict):
        v = detail.get("blocking_namespace")
        if v in ("identities", "tunnels", "mail"):
            return v  # type: ignore[return-value]
    return None


def map_identity_conflict_error(err: InkboxAPIError) -> Exception:
    """If ``err`` is a 409 collision from the identities surface,
    return a :class:`HandleUnavailableError`; else return ``err``."""
    if err.status_code == 409:
        return HandleUnavailableError(
            err.status_code,
            err.detail,
            _read_blocking_namespace(err.detail),
        )
    return err


__all__ = [
    "BlockingNamespace",
    "HandleUnavailableError",
    "InkboxAPIError",
    "InkboxError",
    "map_identity_conflict_error",
]
