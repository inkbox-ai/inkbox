"""
inkbox/webhook_subscriptions.py

Webhook subscriptions -- fan-out per ``(owner, url, event_types)``.

Replaces the legacy per-resource ``webhook_url`` columns on mailboxes
and phone numbers. Use this resource to attach HTTPS receivers to mail
(``message.*``), phone-text (``text.*``), or iMessage (``imessage.*``)
events. Mail and text subscriptions are owned by the mailbox / phone
number; iMessage subscriptions are owned by the agent identity, since
shared iMessage pool numbers are not org resources. Incoming-call
webhooks (``phone.incoming_call``) are still set on the phone-number
resource itself -- that channel is a synchronous control-plane
callback whose response body drives call routing, so fan-out is not
meaningful.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

# `_UNSET` is imported from inkbox.identities.types -- identity-based
# `is not _UNSET` checks must compare against the same object across
# all layers. A module-local sentinel would leak onto the wire body.
from inkbox.identities.types import _UNSET

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


_BASE = "/webhooks/subscriptions"
_INCOMING_CALL = "phone.incoming_call"

WebhookSubscriptionStatus = Literal["active", "deleted"]


@dataclass
class WebhookSubscription:
    """A webhook subscription row returned by the API.

    Exactly one of ``mailbox_id`` / ``phone_number_id`` /
    ``agent_identity_id`` is populated.
    ``organization_id`` is an ``"org_..."`` token string, not a UUID.
    ``status`` is always ``"active"`` for subscriptions callers can
    observe; deleted subscriptions are not returned by ``list`` /
    ``get``.
    """

    id: UUID
    organization_id: str
    mailbox_id: UUID | None
    phone_number_id: UUID | None
    agent_identity_id: UUID | None
    url: str
    event_types: list[str]
    status: WebhookSubscriptionStatus
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WebhookSubscription:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            mailbox_id=UUID(d["mailbox_id"]) if d["mailbox_id"] else None,
            phone_number_id=UUID(d["phone_number_id"]) if d["phone_number_id"] else None,
            agent_identity_id=(
                UUID(d["agent_identity_id"]) if d.get("agent_identity_id") else None
            ),
            url=d["url"],
            event_types=list(d["event_types"]),
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


def _assert_url_not_none(url: Any) -> None:
    if url is None:
        raise ValueError(
            "url must not be None; pass a string, or omit the field to "
            "leave it unchanged",
        )


def _assert_event_types_not_none(event_types: Any) -> None:
    if event_types is None:
        raise ValueError(
            "event_types must not be None; pass a non-empty list, or "
            "omit the field to leave it unchanged",
        )


def _assert_event_types_non_empty_distinct(event_types: list[str]) -> None:
    if not event_types:
        raise ValueError("event_types must be a non-empty list")
    seen: set[str] = set()
    for e in event_types:
        if e in seen:
            raise ValueError(f"event_types contains duplicate value: {e!r}")
        seen.add(e)


def _assert_no_incoming_call(event_types: list[str]) -> None:
    if _INCOMING_CALL in event_types:
        raise ValueError(
            f"event_type {_INCOMING_CALL!r} is not stored in webhook "
            "subscriptions; set it on the phone number's "
            "`incoming_call_webhook_url` field instead",
        )


_OWNER_EVENT_PREFIXES = {
    "mailbox": "message.",
    "phone_number": "text.",
    "agent_identity": "imessage.",
}


def _assert_channel_coherence(
    *,
    owner: str,
    event_types: list[str],
) -> None:
    expected_prefix = _OWNER_EVENT_PREFIXES[owner]
    for e in event_types:
        if e.startswith(expected_prefix):
            continue
        for other_owner, other_prefix in _OWNER_EVENT_PREFIXES.items():
            if other_owner != owner and e.startswith(other_prefix):
                raise ValueError(
                    f"event_type {e!r} does not belong to the {owner!r} channel "
                    f"(it belongs to {other_owner!r})",
                )
        raise ValueError(
            f"event_type {e!r} does not belong to any known channel",
        )


def _uuid_str(value: UUID | str) -> str:
    return str(value)


class WebhookSubscriptionsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        mailbox_id: UUID | str | None = None,
        phone_number_id: UUID | str | None = None,
        agent_identity_id: UUID | str | None = None,
        url: str | None = None,
        event_type: str | None = None,
    ) -> list[WebhookSubscription]:
        """List webhook subscriptions visible to the caller.

        Filters AND-combine. ``mailbox_id`` / ``phone_number_id`` /
        ``agent_identity_id`` are mutually exclusive -- passing more
        than one yields a 422. Deleted subscriptions are not returned.
        """
        params: dict[str, Any] = {}
        if mailbox_id is not None:
            params["mailbox_id"] = _uuid_str(mailbox_id)
        if phone_number_id is not None:
            params["phone_number_id"] = _uuid_str(phone_number_id)
        if agent_identity_id is not None:
            params["agent_identity_id"] = _uuid_str(agent_identity_id)
        if url is not None:
            params["url"] = url
        if event_type is not None:
            params["event_type"] = event_type
        data = self._http.get(_BASE, params=params)
        return [WebhookSubscription._from_dict(d) for d in data["subscriptions"]]

    def get(self, sub_id: UUID | str) -> WebhookSubscription:
        """Fetch a single subscription by id. Returns 404 if the subscription has been deleted or is not visible to the caller."""
        data = self._http.get(f"{_BASE}/{_uuid_str(sub_id)}")
        return WebhookSubscription._from_dict(data)

    def create(
        self,
        *,
        url: str,
        event_types: list[str],
        mailbox_id: UUID | str | None = None,
        phone_number_id: UUID | str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> WebhookSubscription:
        """Create a webhook subscription.

        Exactly one of ``mailbox_id`` / ``phone_number_id`` /
        ``agent_identity_id`` is required. ``event_types`` must be a
        non-empty list of distinct values belonging to the owner's
        channel (mailbox -> ``message.*``, phone number -> ``text.*``,
        agent identity -> ``imessage.*``).
        """
        owners: dict[str, UUID | str | None] = {
            "mailbox": mailbox_id,
            "phone_number": phone_number_id,
            "agent_identity": agent_identity_id,
        }
        populated = [name for name, value in owners.items() if value is not None]
        if len(populated) != 1:
            raise ValueError(
                "Exactly one of mailbox_id, phone_number_id, or "
                "agent_identity_id must be provided",
            )
        owner = populated[0]
        _assert_url_not_none(url)
        _assert_event_types_not_none(event_types)
        _assert_event_types_non_empty_distinct(event_types)
        _assert_no_incoming_call(event_types)
        _assert_channel_coherence(
            owner=owner,
            event_types=event_types,
        )

        body: dict[str, Any] = {
            "url": url,
            "event_types": list(event_types),
            f"{owner}_id": _uuid_str(owners[owner]),  # type: ignore[arg-type]
        }
        data = self._http.post(_BASE, json=body)
        return WebhookSubscription._from_dict(data)

    def update(
        self,
        sub_id: UUID | str,
        *,
        url: str = _UNSET,  # type: ignore[assignment]
        event_types: list[str] = _UNSET,  # type: ignore[assignment]
    ) -> WebhookSubscription:
        """Update the URL and/or event-type list of a subscription.

        ``event_types``, if supplied, replaces the stored list and must
        be non-empty and distinct. Owner FKs are not mutable. Omitting
        both kwargs is a no-op.
        """
        body: dict[str, Any] = {}
        if url is not _UNSET:
            _assert_url_not_none(url)
            body["url"] = url
        if event_types is not _UNSET:
            _assert_event_types_not_none(event_types)
            _assert_event_types_non_empty_distinct(event_types)
            _assert_no_incoming_call(event_types)
            body["event_types"] = list(event_types)
        data = self._http.patch(f"{_BASE}/{_uuid_str(sub_id)}", json=body)
        return WebhookSubscription._from_dict(data)

    def delete(self, sub_id: UUID | str) -> None:
        """Delete a subscription. Subsequent ``list`` / ``get`` calls will not return it."""
        self._http.delete(f"{_BASE}/{_uuid_str(sub_id)}")
