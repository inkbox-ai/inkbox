"""
inkbox/webhook_subscriptions.py

Webhook subscriptions -- fan-out per ``(owner, url, event_types)``.

Replaces the legacy per-resource ``webhook_url`` columns on mailboxes
and phone numbers. Use this resource to attach HTTPS receivers to mail
(``message.*``), phone-text (``text.*``), iMessage (``imessage.*``), or
post-call lifecycle (``call.ended``) events. Mail and text subscriptions
are owned by the mailbox / phone number; iMessage and call-lifecycle
subscriptions are owned by the agent identity, since shared iMessage pool
numbers are not org resources and a call is only ever owned by its
identity. An identity may hold an iMessage sub and a call-lifecycle sub,
but a single subscription carries only one channel. Incoming-call
webhooks (``phone.incoming_call``) are still set on the phone-number
resource itself -- that channel is a synchronous control-plane
callback whose response body drives call routing, so fan-out is not
meaningful.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal, TypedDict
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

_CONTEXT_CLASSES = ("email", "texts", "calls")
_CONTEXT_MAX_COUNT = 50
_CONTEXT_MAX_WINDOW_HOURS = 168


class WebhookContextCountConfig(TypedDict):
    """Count-mode context: the last ``count`` items of a class (1..50)."""
    mode: Literal["count"]
    count: int


class WebhookContextWindowConfig(TypedDict):
    """Window-mode context: items from the last ``hours`` hours (1..168)."""
    mode: Literal["window"]
    hours: int


WebhookContextClassConfig = WebhookContextCountConfig | WebhookContextWindowConfig


class WebhookContextConfig(TypedDict, total=False):
    """Per-subscription conversation-context config, keyed by class.

    Omit a class to leave it unconfigured. The server echoes unconfigured
    classes back as explicit ``null``, so a round-tripped value may carry
    ``None`` per class — truthy-check a class, don't test key presence.
    """
    email: WebhookContextClassConfig | None
    texts: WebhookContextClassConfig | None
    calls: WebhookContextClassConfig | None


@dataclass
class WebhookSubscription:
    """A webhook subscription row returned by the API.

    Exactly one of ``mailbox_id`` / ``phone_number_id`` /
    ``agent_identity_id`` (the raw owner FK) is populated.
    ``owner_identity_id`` is the **resolved** owning agent identity for
    every subscription regardless of channel — mail/phone subs resolve
    it server-side through the mailbox / phone number, while iMessage
    subs carry it directly. (Optional for forward-compatibility: ``None``
    on servers that predate the field.)
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
    owner_identity_id: UUID | None = None
    context_config: WebhookContextConfig | None = None

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
            owner_identity_id=(
                UUID(d["owner_identity_id"]) if d.get("owner_identity_id") else None
            ),
            context_config=d.get("context_config"),
        )


@dataclass
class WebhookSubscriptionCreateResponse(WebhookSubscription):
    """The response from creating a webhook subscription.

    Extends :class:`WebhookSubscription` with a one-time ``signing_key``.
    It is populated **only** on the request that first mints the owning
    identity's signing key (returned once — store it securely); on every
    other create it is ``None``. List/get/update never return it.
    """

    signing_key: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> WebhookSubscriptionCreateResponse:
        base = WebhookSubscription._from_dict(d)
        return cls(**base.__dict__, signing_key=d.get("signing_key"))


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


# Wire event-type prefix -> the owning resource whose channel it belongs to.
# An agent identity owns two channels (iMessage + post-call lifecycle), so two
# prefixes map to it; a single subscription may still only carry one channel.
_EVENT_PREFIX_TO_OWNER = {
    "message.": "mailbox",
    "text.": "phone_number",
    "imessage.": "agent_identity",
    "call.": "agent_identity",
}

# Owner resource -> the event-type prefixes it may subscribe to.
_OWNER_EVENT_PREFIXES = {
    "mailbox": ("message.",),
    "phone_number": ("text.",),
    "agent_identity": ("imessage.", "call."),
}


def _assert_channel_coherence(
    *,
    owner: str,
    event_types: list[str],
) -> None:
    allowed = _OWNER_EVENT_PREFIXES[owner]
    # The first event's prefix fixes the channel; every event must share it so
    # one subscription never straddles two channels (e.g. imessage.* + call.ended).
    channel_prefix: str | None = None
    for e in event_types:
        prefix = next((p for p in _EVENT_PREFIX_TO_OWNER if e.startswith(p)), None)
        if prefix is None:
            raise ValueError(
                f"event_type {e!r} does not belong to any known channel",
            )
        if prefix not in allowed:
            raise ValueError(
                f"event_type {e!r} does not belong to the {owner!r} channel "
                f"(it belongs to {_EVENT_PREFIX_TO_OWNER[prefix]!r})",
            )
        if channel_prefix is None:
            channel_prefix = prefix
        elif prefix != channel_prefix:
            raise ValueError(
                f"event_type {e!r} does not belong to the same channel as the "
                f"other event types in this subscription",
            )


def _assert_valid_context_config(cfg: Any) -> None:
    """Validate context_config against the server's rules (fail fast).

    Known class keys only; each non-null entry is count (1..50) or window
    (1..168) with no stray keys. A ``None`` class value is allowed (server
    treats it as unconfigured) and skipped.
    """
    if not isinstance(cfg, dict):
        raise ValueError("context_config must be a dict of class -> mode config")
    unknown = set(cfg) - set(_CONTEXT_CLASSES)
    if unknown:
        raise ValueError(
            f"context_config has unknown class keys {sorted(unknown)!r}; "
            f"allowed: {list(_CONTEXT_CLASSES)!r}",
        )
    for klass, entry in cfg.items():
        if entry is not None:
            _assert_valid_context_entry(klass, entry)


def _assert_valid_context_entry(klass: str, entry: Any) -> None:
    if not isinstance(entry, dict):
        raise ValueError(f"context_config[{klass!r}] must be a mode config object")
    mode = entry.get("mode")
    if mode == "count":
        _assert_context_int(klass, entry, "count", _CONTEXT_MAX_COUNT)
    elif mode == "window":
        _assert_context_int(klass, entry, "hours", _CONTEXT_MAX_WINDOW_HOURS)
    else:
        raise ValueError(
            f"context_config[{klass!r}].mode must be 'count' or 'window', "
            f"got {mode!r}",
        )


def _assert_context_int(klass: str, entry: dict, key: str, hi: int) -> None:
    allowed = {"mode", key}
    unknown = set(entry) - allowed
    if unknown:
        raise ValueError(
            f"context_config[{klass!r}] has unknown keys {sorted(unknown)!r}; "
            f"allowed: {sorted(allowed)!r}",
        )
    value = entry.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or not (1 <= value <= hi):
        raise ValueError(
            f"context_config[{klass!r}].{key} must be an int in 1..{hi}",
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
        context_config: WebhookContextConfig | None = None,
    ) -> WebhookSubscriptionCreateResponse:
        """Create a webhook subscription.

        Exactly one of ``mailbox_id`` / ``phone_number_id`` /
        ``agent_identity_id`` is required. ``event_types`` must be a
        non-empty list of distinct values belonging to the owner's
        channel (mailbox -> ``message.*``, phone number -> ``text.*``,
        agent identity -> ``imessage.*`` or ``call.ended``). One
        subscription carries a single channel, so an identity sub may not
        mix ``imessage.*`` with ``call.ended``.

        ``context_config`` opts the subscription into per-class conversation
        context (email/texts/calls) delivered on received events; omit it
        for none. See :class:`WebhookContextConfig`.

        Returns a :class:`WebhookSubscriptionCreateResponse`. Its
        ``signing_key`` is populated **once** when this is the first
        subscription for an identity that had no signing key yet — store
        it securely; it is the only time the plaintext secret is shown.
        Otherwise ``signing_key`` is ``None``.
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
        if context_config is not None:
            _assert_valid_context_config(context_config)
            body["context_config"] = context_config
        data = self._http.post(_BASE, json=body)
        return WebhookSubscriptionCreateResponse._from_dict(data)

    def update(
        self,
        sub_id: UUID | str,
        *,
        url: str = _UNSET,  # type: ignore[assignment]
        event_types: list[str] = _UNSET,  # type: ignore[assignment]
        context_config: WebhookContextConfig | None = _UNSET,  # type: ignore[assignment]
    ) -> WebhookSubscription:
        """Update the URL, event-type list, and/or context config.

        ``event_types``, if supplied, replaces the stored list and must
        be non-empty and distinct. Owner FKs are not mutable.

        ``context_config`` is tri-state and the one field where ``None``
        is meaningful on the wire: omitted = unchanged, ``None`` = clear
        (send JSON ``null``), a dict = validate and replace. Omitting
        every kwarg is a no-op.
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
        if context_config is not _UNSET:
            if context_config is None:
                body["context_config"] = None
            else:
                _assert_valid_context_config(context_config)
                body["context_config"] = context_config
        data = self._http.patch(f"{_BASE}/{_uuid_str(sub_id)}", json=body)
        return WebhookSubscription._from_dict(data)

    def delete(self, sub_id: UUID | str) -> None:
        """Delete a subscription. Subsequent ``list`` / ``get`` calls will not return it."""
        self._http.delete(f"{_BASE}/{_uuid_str(sub_id)}")
