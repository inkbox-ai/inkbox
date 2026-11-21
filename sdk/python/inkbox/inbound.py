"""
inkbox/inbound.py

Inbound sources for hosted agents. Each source has a public URL that accepts
requests from an external service (for example a payment or code-hosting
webhook), optionally verifies the sender's signature, and delivers each
request to the agent as an ``inbound.received`` event.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, NotRequired, TypedDict
from urllib.parse import quote

from inkbox.webhooks import InboundWebhookRequest

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

InboundEventStatus = Literal["pending", "delivered", "failed"]


class InboundSignature(TypedDict):
    """How the sender signs requests (HMAC); the secret is never returned.

    ``signed_content`` is a template of what was signed and must contain ``{body}``;
    it may also use ``{timestamp}``, ``{header:Name}`` and fixed text.
    """

    secret_encoding: Literal["text", "base64"]
    header: str
    format: Literal["whole", "prefix", "list"]
    format_value: str | None
    algorithm: Literal["sha256", "sha1", "sha512"]
    encoding: Literal["hex", "base64"]
    signed_content: str
    timestamp_from: Literal["none", "header", "list"]
    timestamp_value: str | None
    max_age_seconds: int | None


class InboundSignatureInput(TypedDict):
    """Signature settings to verify the sender. Omitted fields take the server defaults.

    ``format``: ``whole`` (the header value is the signature), ``prefix`` (the value after
    ``format_value``, for example ``sha256=``) or ``list`` (every item under key ``format_value``
    in a list such as ``t=1,v1=ab`` or ``v1,ab v1,cd``; any match passes).
    ``secret_encoding="base64"`` decodes the secret first, ignoring a leading ``whsec_``.
    ``timestamp_from`` is ``header`` (header ``timestamp_value``) or ``list`` (key ``timestamp_value``
    in the signature header); ``max_age_seconds`` rejects requests whose timestamp is further from now.
    """

    secret: str
    header: str
    secret_encoding: NotRequired[Literal["text", "base64"]]
    format: NotRequired[Literal["whole", "prefix", "list"]]
    format_value: NotRequired[str]
    algorithm: NotRequired[Literal["sha256", "sha1", "sha512"]]
    encoding: NotRequired[Literal["hex", "base64"]]
    signed_content: NotRequired[str]
    timestamp_from: NotRequired[Literal["none", "header", "list"]]
    timestamp_value: NotRequired[str]
    max_age_seconds: NotRequired[int]


@dataclass
class InboundSignatureCheck:
    verified: bool
    reason: str | None


class InboundAgentHandlerInput(TypedDict):
    type: Literal["agent"]
    instructions: NotRequired[str | None]


class InboundScriptHandlerInput(TypedDict):
    type: Literal["script"]
    command: str


InboundHandler = InboundAgentHandlerInput | InboundScriptHandlerInput


@dataclass
class InboundSource:
    id: str
    name: str
    url: str
    signature: InboundSignature | None
    handler: InboundHandler
    created_at: str
    updated_at: str

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> InboundSource:
        return cls(
            id=d["id"], name=d["name"], url=d["url"], signature=d.get("signature"),
            handler=d["handler"], created_at=d["created_at"], updated_at=d["updated_at"],
        )


@dataclass
class InboundEvent:
    id: str
    source_id: str
    received_at: str
    status: InboundEventStatus
    attempts: int
    last_error: str | None
    signature_verified: bool
    content_type: str | None
    size_bytes: int
    request: InboundWebhookRequest | None = None  # only on get_event

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> InboundEvent:
        return cls(
            id=d["id"], source_id=d["source_id"], received_at=d["received_at"],
            status=d["status"], attempts=d["attempts"], last_error=d.get("last_error"),
            signature_verified=d["signature_verified"], content_type=d.get("content_type"),
            size_bytes=d["size_bytes"], request=d.get("request"),
        )


@dataclass
class InboundEventPage:
    events: list[InboundEvent]
    next_cursor: str | None


class InboundResource:
    """Manage an identity's inbound sources and events. The identity must be hosted."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    @staticmethod
    def _path(handle: str, *parts: str) -> str:
        return "/".join([f"/{quote(handle, safe='')}/inbound", *(quote(p, safe="") for p in parts)])

    def create_source(
        self,
        handle: str,
        *,
        name: str,
        handler: InboundHandler,
        signature: InboundSignatureInput | None = None,
    ) -> InboundSource:
        body = {"name": name, "signature": signature, "handler": handler}
        return InboundSource._from_dict(self._http.post(self._path(handle), json=body))

    def list_sources(self, handle: str) -> list[InboundSource]:
        data = self._http.get(self._path(handle))
        return [InboundSource._from_dict(s) for s in data["sources"]]

    def get_source(self, handle: str, source_id: str) -> InboundSource:
        return InboundSource._from_dict(self._http.get(self._path(handle, source_id)))

    def update_source(
        self,
        handle: str,
        source_id: str,
        *,
        name: str | None = None,
        handler: InboundHandler | None = None,
        signature: InboundSignatureInput | None | Literal[False] = False,
    ) -> InboundSource:
        """Update a source. Omitted fields are unchanged; ``signature=None`` removes verification."""
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if handler is not None:
            body["handler"] = handler
        if signature is not False:
            body["signature"] = signature
        return InboundSource._from_dict(self._http.patch(self._path(handle, source_id), json=body))

    def delete_source(self, handle: str, source_id: str) -> None:
        self._http.delete(self._path(handle, source_id))

    def rotate_source(self, handle: str, source_id: str) -> InboundSource:
        """Issue a new URL; the previous URL stops accepting requests."""
        return InboundSource._from_dict(self._http.post(self._path(handle, source_id, "rotate")))

    def check_signature(
        self,
        handle: str,
        *,
        headers: dict[str, str],
        body: str | bytes,
        signature: InboundSignatureInput | None = None,
        source_id: str | None = None,
    ) -> InboundSignatureCheck:
        """Check a sample request against ``signature`` settings or a saved source's; nothing is stored.

        Pass exactly one of ``signature`` or ``source_id``. ``bytes`` bodies are sent unchanged.
        """
        payload: dict[str, Any] = {"headers": headers}
        if isinstance(body, bytes):
            payload |= {"body": base64.b64encode(body).decode(), "body_encoding": "base64"}
        else:
            payload["body"] = body
        if signature is not None:
            payload["signature"] = signature
        if source_id is not None:
            payload["source_id"] = source_id
        data = self._http.post(self._path(handle, "signature-check"), json=payload)
        return InboundSignatureCheck(verified=data["verified"], reason=data.get("reason"))

    def list_events(
        self, handle: str, source_id: str, *, limit: int | None = None, cursor: str | None = None,
    ) -> InboundEventPage:
        data = self._http.get(self._path(handle, source_id, "events"), params={"limit": limit, "cursor": cursor})
        return InboundEventPage(
            events=[InboundEvent._from_dict(e) for e in data["events"]],
            next_cursor=data.get("next_cursor"),
        )

    def get_event(self, handle: str, source_id: str, event_id: str) -> InboundEvent:
        """Get an event, including the received ``request``."""
        return InboundEvent._from_dict(self._http.get(self._path(handle, source_id, "events", event_id)))

    def replay_event(self, handle: str, source_id: str, event_id: str) -> InboundEvent:
        """Deliver the event to the agent again."""
        return InboundEvent._from_dict(self._http.post(self._path(handle, source_id, "events", event_id, "replay")))

    def report_inbound_event_result(
        self,
        handle: str,
        source_id: str,
        event_id: str,
        *,
        status: Literal["failed"],
        error: str,
        delivery_id: str,
    ) -> None:
        """Report that the agent could not process a delivery. Requires the identity's own API key.

        ``delivery_id`` is the ``delivery_id`` of the ``inbound.received`` payload. The server
        answers 409 ``stale_delivery`` when the event has since been delivered again.
        """
        self._http.post(
            self._path(handle, source_id, "events", event_id, "result"),
            json={"status": status, "error": error, "delivery_id": delivery_id},
        )
