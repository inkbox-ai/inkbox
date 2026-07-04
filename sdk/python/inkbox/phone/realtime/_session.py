"""
inkbox/phone/realtime/_session.py

The realtime control channel: an async-iterable observe stream plus
intervene commands. ``RealtimeResource.connect`` opens the channel and
subscribes; the returned session yields typed events and sends commands.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, AsyncIterator, Awaitable, Callable
from urllib.parse import urlparse, urlunparse
from uuid import UUID

from inkbox.phone.realtime.events import RealtimeEvent, parse_event
from inkbox.phone.realtime._transport import RealtimeConnectError, WsTransport

if TYPE_CHECKING:
    from typing import Protocol

    class _Transport(Protocol):
        async def send_text(self, text: str) -> None: ...
        async def recv(self) -> str | None: ...
        async def close(self) -> None: ...

_CONTROL_PATH = "/api/v1/phone/ws/realtime-control"


class RealtimeControlSession:
    """Live observe + intervene handle for one control-channel connection.

    Async-iterate the session to receive observe events; call the intervene
    methods to steer the live call. Usable as an async context manager.
    """

    def __init__(self, transport: "_Transport") -> None:
        self._transport = transport

    async def __aenter__(self) -> RealtimeControlSession:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    def __aiter__(self) -> AsyncIterator[RealtimeEvent]:
        return self

    async def __anext__(self) -> RealtimeEvent:
        message = await self._transport.recv()
        if message is None:
            raise StopAsyncIteration
        return parse_event(json.loads(message))

    async def _send(self, command: dict[str, Any]) -> None:
        await self._transport.send_text(json.dumps(command, separators=(",", ":")))

    async def answer_consult(
        self, consult_id: str, answer: str, instructions: str | None = None,
    ) -> None:
        """Resolve a ``consult.requested`` with an answer for the caller."""
        command: dict[str, Any] = {
            "event": "consult.answer", "consult_id": consult_id, "answer": answer,
        }
        if instructions is not None:
            command["instructions"] = instructions
        await self._send(command)

    async def say(self, call_id: str, text: str) -> None:
        """Have the voice agent speak ``text`` on the call now."""
        await self._send({"event": "inject", "call_id": call_id, "mode": "say", "text": text})

    async def inject_context(self, call_id: str, text: str) -> None:
        """Add hidden system context to the live session without speaking."""
        await self._send({"event": "inject", "call_id": call_id, "mode": "context", "text": text})

    async def approve_tool(self, call_id: str, tool_call_id: str) -> None:
        """Approve a tool call awaiting a decision."""
        await self._send({
            "event": "tool.decision", "call_id": call_id,
            "tool_call_id": tool_call_id, "decision": "approve",
        })

    async def deny_tool(
        self, call_id: str, tool_call_id: str, reason: str | None = None,
    ) -> None:
        """Deny a tool call awaiting a decision."""
        command: dict[str, Any] = {
            "event": "tool.decision", "call_id": call_id,
            "tool_call_id": tool_call_id, "decision": "deny",
        }
        if reason is not None:
            command["reason"] = reason
        await self._send(command)

    async def update_instructions(self, call_id: str, instructions: str) -> None:
        """Replace the live session instructions."""
        await self._send({
            "event": "update_instructions", "call_id": call_id, "instructions": instructions,
        })

    async def hang_up(self, call_id: str, reason: str | None = None) -> None:
        """Force-end the call."""
        command: dict[str, Any] = {"event": "hang_up", "call_id": call_id}
        if reason is not None:
            command["reason"] = reason
        await self._send(command)

    async def close(self) -> None:
        """Close the control channel."""
        await self._transport.close()


# Injectable for tests: build a connected transport from URL/headers/timeout.
TransportFactory = Callable[[str, dict[str, str], float], Awaitable["_Transport"]]


class RealtimeResource:
    """Opens realtime control channels for the platform-hosted voice agent."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float = 30.0,
        transport_factory: TransportFactory | None = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._timeout = timeout
        self._transport_factory = transport_factory or _default_transport_factory

    async def connect(
        self,
        *,
        call_id: str | None = None,
        agent_identity_id: UUID | str | None = None,
    ) -> RealtimeControlSession:
        """Open the control channel and subscribe.

        Provide exactly one of ``call_id`` (one live call) or
        ``agent_identity_id`` (all live + future calls for the identity).
        """
        if (call_id is None) == (agent_identity_id is None):
            raise ValueError("pass exactly one of call_id or agent_identity_id")
        transport = await self._transport_factory(
            self._control_url(), {"X-Service-Token": self._api_key}, self._timeout,
        )
        session = RealtimeControlSession(transport)
        subscribe: dict[str, Any] = {"event": "subscribe"}
        if call_id is not None:
            subscribe["call_id"] = call_id
        else:
            subscribe["agent_identity_id"] = str(agent_identity_id)
        try:
            await session._send(subscribe)
        except Exception:
            await session.close()
            raise
        return session

    def _control_url(self) -> str:
        parsed = urlparse(self._base_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return urlunparse((scheme, parsed.netloc, _CONTROL_PATH, "", "", ""))


async def _default_transport_factory(
    url: str, headers: dict[str, str], timeout: float,
) -> WsTransport:
    return await WsTransport.connect(url, headers=headers, timeout=timeout)


__all__ = [
    "RealtimeControlSession",
    "RealtimeResource",
    "RealtimeConnectError",
]
