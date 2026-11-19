"""
inkbox/inbound.py

Inbound sources for hosted agents. Each source has a public URL that accepts
requests from an external service (for example a payment or code-hosting
webhook), optionally verifies the sender's signature, and delivers each
request to the agent as an ``inbound.received`` event.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, NotRequired, TypedDict
from urllib.parse import quote

from inkbox.webhooks import InboundWebhookRequest

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

InboundSignatureScheme = Literal["stripe", "github", "slack", "standard-webhooks", "hmac"]
InboundEventStatus = Literal["pending", "delivered", "failed"]


class InboundSignatureInput(TypedDict):
    """Sender signature check. ``header``/``algorithm``/``encoding``/``prefix`` apply to ``hmac``."""

    scheme: InboundSignatureScheme
    secret: str
    header: NotRequired[str]
    algorithm: NotRequired[Literal["sha256", "sha1"]]
    encoding: NotRequired[Literal["hex", "base64"]]
    prefix: NotRequired[str]


class InboundSignature(TypedDict):
    """Signature settings as returned; the secret is never returned."""

    scheme: InboundSignatureScheme
    header: NotRequired[str | None]
    algorithm: NotRequired[str | None]
    encoding: NotRequired[str | None]
    prefix: NotRequired[str | None]


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
    ) -> None:
        """Report that the agent could not process an event. Requires the identity's own API key."""
        self._http.post(
            self._path(handle, source_id, "events", event_id, "result"),
            json={"status": status, "error": error},
        )
