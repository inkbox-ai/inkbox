"""
inkbox/phone/resources/sms_opt_ins.py

SMS opt-in / opt-out registry (per-(org, receiver) consent state).

Reads (``list``, ``get``) are available to any admin or JWT caller.
Writes (``opt_in``, ``opt_out``) are gated server-side to orgs that
run their own active, customer-managed 10DLC campaign — orgs on the
Inkbox-default campaign share consent state and can't override it
through this API. Calling ``opt_in`` / ``opt_out`` from a
default-campaign org will raise an :class:`InkboxAPIError` with a
409 status.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from inkbox.phone.types import SmsOptIn, SmsOptInStatus

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_BASE = "/sms-opt-ins"


def _path(receiver_number: str | None = None, action: str | None = None) -> str:
    if receiver_number is None:
        return _BASE
    if action is None:
        return f"{_BASE}/{receiver_number}"
    return f"{_BASE}/{receiver_number}/{action}"


class SmsOptInsResource:
    """Per-(org, receiver) SMS opt-in / opt-out state."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        status: SmsOptInStatus | str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[SmsOptIn]:
        """List the calling org's SMS opt-in rows, newest-updated first.

        Args:
            status: Filter to ``opted_in`` or ``opted_out``. Omit for both.
            limit: Max rows to return (1-200; server rejects values above 200).
            offset: Number of rows to skip for pagination.
        """
        params: dict[str, Any] = {}
        if status is not None:
            params["status"] = (
                status.value if isinstance(status, SmsOptInStatus) else status
            )
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        data = self._http.get(_path(), params=params)
        return [SmsOptIn._from_dict(r) for r in data]

    def get(self, receiver_number: str) -> SmsOptIn:
        """Get the opt-in row for one E.164 recipient.

        Raises :class:`InkboxAPIError` with status 404 if no row exists.
        """
        data = self._http.get(_path(receiver_number))
        return SmsOptIn._from_dict(data)

    def opt_in(self, receiver_number: str) -> SmsOptIn:
        """Mark a recipient as opted in (admin-only, customer-campaign orgs only).

        Server records an audit event with ``source=api``.
        Raises :class:`InkboxAPIError` with status 409 (error
        ``customer_campaign_required``) when the calling org is on
        the Inkbox-default campaign rather than its own.
        """
        data = self._http.post(_path(receiver_number, "opt-in"))
        return SmsOptIn._from_dict(data)

    def opt_out(self, receiver_number: str) -> SmsOptIn:
        """Mark a recipient as opted out (admin-only, customer-campaign orgs only).

        Same auth + campaign gate as :meth:`opt_in`.
        """
        data = self._http.post(_path(receiver_number, "opt-out"))
        return SmsOptIn._from_dict(data)
