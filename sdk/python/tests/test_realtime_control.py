"""
sdk/python/tests/test_realtime_control.py

Tests for the realtime control channel: subscribe on connect, typed event
decoding, and intervene commands. The WebSocket transport is faked.
"""

import json

import pytest

from inkbox.phone.realtime import (
    CallEnded,
    ConsultRequested,
    ModelToolCall,
    RealtimeResource,
    Transcript,
)


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"
CALL_ID = "call_abc123"


class FakeTransport:
    """Records outbound messages; replays a scripted inbound queue."""

    def __init__(self, inbound=None):
        self.sent = []
        self._inbound = list(inbound or [])
        self.closed = False

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def recv(self):
        if self._inbound:
            return self._inbound.pop(0)
        return None

    async def close(self):
        self.closed = True


def make_resource(transport):
    captured = {}

    async def factory(url, headers, timeout):
        captured["url"] = url
        captured["headers"] = headers
        return transport

    resource = RealtimeResource(
        api_key="sk-test",
        base_url="https://inkbox.ai",
        transport_factory=factory,
    )
    return resource, captured


class TestConnect:
    async def test_connect_subscribes_by_call_id(self):
        transport = FakeTransport()
        resource, captured = make_resource(transport)

        await resource.connect(call_id=CALL_ID)

        assert captured["url"] == "wss://inkbox.ai/api/v1/phone/ws/realtime-control"
        assert captured["headers"] == {"X-Service-Token": "sk-test"}
        assert transport.sent == [{"event": "subscribe", "call_id": CALL_ID}]

    async def test_connect_subscribes_by_identity(self):
        transport = FakeTransport()
        resource, _ = make_resource(transport)

        await resource.connect(agent_identity_id=IDENTITY_ID)

        assert transport.sent == [
            {"event": "subscribe", "agent_identity_id": IDENTITY_ID}
        ]

    async def test_connect_requires_exactly_one_target(self):
        resource, _ = make_resource(FakeTransport())
        with pytest.raises(ValueError):
            await resource.connect()
        with pytest.raises(ValueError):
            await resource.connect(call_id=CALL_ID, agent_identity_id=IDENTITY_ID)


class TestObserveEvents:
    async def test_iterates_typed_events_until_close(self):
        inbound = [
            json.dumps({
                "event": "transcript", "call_id": CALL_ID, "party": "remote",
                "text": "hello", "is_final": True, "turn_id": "t1",
            }),
            json.dumps({
                "event": "model.tool_call", "call_id": CALL_ID,
                "tool_call_id": "tc1", "tool_name": "lookup_contact",
                "arguments": {"name": "Ada"}, "requires_approval": True,
            }),
            json.dumps({
                "event": "consult.requested", "call_id": CALL_ID,
                "consult_id": "c1", "query": "refund?",
                "transcript_tail": [{"speaker": "remote", "text": "hi"}],
            }),
            json.dumps({
                "event": "call.ended", "call_id": CALL_ID, "reason": "hangup",
                "post_call_actions": [{"action": "note", "details": {"x": 1}}],
                "transcript": [{"speaker": "local", "text": "bye"}],
            }),
        ]
        transport = FakeTransport(inbound)
        resource, _ = make_resource(transport)
        session = await resource.connect(call_id=CALL_ID)

        events = [event async for event in session]

        assert isinstance(events[0], Transcript)
        assert events[0].text == "hello" and events[0].is_final is True
        assert isinstance(events[1], ModelToolCall)
        assert events[1].requires_approval is True
        assert events[1].arguments == {"name": "Ada"}
        assert isinstance(events[2], ConsultRequested)
        assert events[2].consult_id == "c1"
        assert events[2].transcript_tail[0].text == "hi"
        assert isinstance(events[3], CallEnded)
        assert events[3].post_call_actions[0].action == "note"


class TestInterveneCommands:
    async def _session(self):
        transport = FakeTransport()
        resource, _ = make_resource(transport)
        session = await resource.connect(call_id=CALL_ID)
        transport.sent.clear()  # drop the subscribe frame
        return session, transport

    async def test_answer_consult(self):
        session, transport = await self._session()
        await session.answer_consult("c1", "Yes, full refund", instructions="be warm")
        assert transport.sent == [{
            "event": "consult.answer", "consult_id": "c1",
            "answer": "Yes, full refund", "instructions": "be warm",
        }]

    async def test_say_and_context(self):
        session, transport = await self._session()
        await session.say(CALL_ID, "One moment")
        await session.inject_context(CALL_ID, "VIP customer")
        assert transport.sent == [
            {"event": "inject", "call_id": CALL_ID, "mode": "say", "text": "One moment"},
            {"event": "inject", "call_id": CALL_ID, "mode": "context", "text": "VIP customer"},
        ]

    async def test_tool_decisions(self):
        session, transport = await self._session()
        await session.approve_tool(CALL_ID, "tc1")
        await session.deny_tool(CALL_ID, "tc2", reason="not allowed")
        assert transport.sent == [
            {"event": "tool.decision", "call_id": CALL_ID,
             "tool_call_id": "tc1", "decision": "approve"},
            {"event": "tool.decision", "call_id": CALL_ID,
             "tool_call_id": "tc2", "decision": "deny", "reason": "not allowed"},
        ]

    async def test_update_instructions_and_hang_up_and_close(self):
        session, transport = await self._session()
        await session.update_instructions(CALL_ID, "Speak French")
        await session.hang_up(CALL_ID, reason="resolved")
        await session.close()
        assert transport.sent == [
            {"event": "update_instructions", "call_id": CALL_ID, "instructions": "Speak French"},
            {"event": "hang_up", "call_id": CALL_ID, "reason": "resolved"},
        ]
        assert transport.closed is True

    async def test_async_context_manager_closes(self):
        transport = FakeTransport()
        resource, _ = make_resource(transport)
        async with await resource.connect(call_id=CALL_ID):
            pass
        assert transport.closed is True
