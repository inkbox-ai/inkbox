"""
inkbox/webhook_deliveries.py

Webhook delivery log + manual replay.

Every outbound webhook attempt is recorded as a delivery row: the signed
request body that was sent, the endpoint's HTTP response (or transport
error), and timing. Use ``list`` to inspect what was (or was not)
delivered, and ``replay`` to re-deliver a logged event to its
subscription's current URL.

Replay reuses the original envelope ``event_id``, so it only recovers a
*miss*: a compliant endpoint that already processed the original event
dedupes the replay away. It does not force reprocessing. Incoming-call
deliveries (which have a ``phone_number_id`` and no
``webhook_subscription_id``) are logged but not replayable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


_BASE = "/webhooks/deliveries"


@dataclass
class WebhookDelivery:
    """One logged outbound webhook delivery attempt.

    ``webhook_subscription_id`` is populated for subscription deliveries
    and ``None`` for incoming-call deliveries (which instead carry
    ``phone_number_id``). ``organization_id`` is an ``"org_..."`` token
    string, not a UUID. ``request_payload`` is the raw signed request
    body that was delivered. ``response_status`` / ``response_body`` are
    ``None`` on transport failure (in which case ``error_detail`` is
    set). ``is_replay`` is ``True`` for rows produced by ``replay``.
    """

    id: UUID
    organization_id: str
    webhook_subscription_id: UUID | None
    phone_number_id: UUID | None
    event_id: str
    event_type: str
    url: str
    request_payload: str
    response_status: int | None
    response_body: str | None
    error_detail: str | None
    duration_ms: int | None
    is_replay: bool
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WebhookDelivery:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            webhook_subscription_id=(
                UUID(d["webhook_subscription_id"])
                if d.get("webhook_subscription_id")
                else None
            ),
            phone_number_id=(
                UUID(d["phone_number_id"]) if d.get("phone_number_id") else None
            ),
            event_id=d["event_id"],
            event_type=d["event_type"],
            url=d["url"],
            request_payload=d["request_payload"],
            response_status=d.get("response_status"),
            response_body=d.get("response_body"),
            error_detail=d.get("error_detail"),
            duration_ms=d.get("duration_ms"),
            is_replay=d["is_replay"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )


def _uuid_str(value: UUID | str) -> str:
    return str(value)


class WebhookDeliveriesResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        subscription_id: UUID | str | None = None,
        phone_number_id: UUID | str | None = None,
        event_type: str | None = None,
        success: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[WebhookDelivery]:
        """List logged webhook delivery attempts, newest first.

        Filters AND-combine. ``subscription_id`` scopes to one
        subscription's deliveries; ``phone_number_id`` scopes to a phone
        number's incoming-call deliveries. ``success`` filters on a 2xx
        response (``True`` -> delivered, ``False`` -> failed or no
        response). ``limit`` is clamped to ``[1, 200]`` by the API
        (default 50); ``offset`` paginates.
        """
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if subscription_id is not None:
            params["subscription_id"] = _uuid_str(subscription_id)
        if phone_number_id is not None:
            params["phone_number_id"] = _uuid_str(phone_number_id)
        if event_type is not None:
            params["event_type"] = event_type
        if success is not None:
            params["success"] = success
        data = self._http.get(_BASE, params=params)
        return [WebhookDelivery._from_dict(d) for d in data["deliveries"]]

    def replay(self, delivery_id: UUID | str) -> WebhookDelivery:
        """Re-deliver a logged event to its subscription's current URL.

        Reuses the original envelope ``event_id`` (so a compliant
        endpoint dedupes a replay it already processed) but re-signs with
        a fresh request-id/timestamp, and records a new delivery row with
        ``is_replay=True`` -- which is what this returns.

        Raises if the delivery is an incoming-call row (not replayable,
        422), or if its subscription is no longer active or no longer
        subscribes to the event type (409).
        """
        data = self._http.post(f"{_BASE}/{_uuid_str(delivery_id)}/replay")
        return WebhookDelivery._from_dict(data)
