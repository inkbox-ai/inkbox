"""
sdk/python/tests/test_realtime.py

Observe/intervene frames for platform-hosted calls: typed decoding of the
inbound frames and construction of the outbound intervene frames. Observe
frames carry the ``call_id`` they belong to; the outbound intervene frames
omit it, since that socket is already scoped to one call.
"""

from inkbox.phone.realtime import (
    BargeIn,
    CallEnded,
    CallStarted,
    ConsultRequested,
    Transcript,
    UnknownEvent,
    consult_answer,
    hang_up,
    inject_context,
    parse_event,
    say,
    update_instructions,
)


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"
CALL_ID = "call_abc123"


class TestParseObserveEvents:
    def test_call_started_carries_identity_and_optional_number(self):
        started = parse_event({
            "event": "call.started", "call_id": CALL_ID,
            "agent_identity_id": IDENTITY_ID, "direction": "inbound",
        })
        assert isinstance(started, CallStarted)
        assert started.agent_identity_id == IDENTITY_ID
        assert started.direction == "inbound"
        assert started.phone_number is None  # absent on some inbound legs

    def test_transcript_and_barge_in_carry_call_id(self):
        transcript = parse_event({
            "event": "transcript", "call_id": CALL_ID, "party": "remote",
            "text": "hello", "is_final": True, "turn_id": "t1",
        })
        assert isinstance(transcript, Transcript)
        assert transcript.call_id == CALL_ID
        assert transcript.party == "remote" and transcript.is_final is True
        assert transcript.turn_id == "t1"

        # barge_in carries only call_id + optional turn_id on the hosted-call wire.
        barge = parse_event({
            "event": "barge_in", "call_id": CALL_ID, "turn_id": None,
        })
        assert isinstance(barge, BargeIn)
        assert barge.call_id == CALL_ID
        assert barge.turn_id is None  # optional

    def test_consult_and_ended(self):
        consult = parse_event({
            "event": "consult.requested", "call_id": CALL_ID, "consult_id": "c1",
            "query": "refund?",
            "transcript_tail": [{"party": "remote", "text": "hi"}],
        })
        assert isinstance(consult, ConsultRequested)
        assert consult.call_id == CALL_ID
        assert consult.consult_id == "c1"
        assert consult.transcript_tail[0].text == "hi"

        ended = parse_event({
            "event": "call.ended", "call_id": CALL_ID, "reason": "hangup",
            "post_call_actions": [{"action": "note", "details": {"x": 1}}],
            "transcript": [{"party": "local", "text": "bye"}],
        })
        assert isinstance(ended, CallEnded)
        assert ended.call_id == CALL_ID
        assert ended.reason == "hangup"
        assert ended.post_call_actions[0].action == "note"
        assert ended.transcript[0].text == "bye"

    def test_unknown_tag_falls_back(self):
        event = parse_event({"event": "future.thing", "x": 1})
        assert isinstance(event, UnknownEvent)
        assert event.raw["x"] == 1  # forward-compat: raw payload retained


class TestInterveneBuilders:
    def test_consult_answer(self):
        assert consult_answer("c1", "Yes, full refund", instructions="be warm") == {
            "event": "consult.answer", "consult_id": "c1",
            "answer": "Yes, full refund", "instructions": "be warm",
        }
        assert consult_answer("c1", "ok") == {
            "event": "consult.answer", "consult_id": "c1", "answer": "ok",
        }

    def test_say_and_context(self):
        assert say("One moment") == {"event": "inject", "mode": "say", "text": "One moment"}
        assert inject_context("VIP customer") == {
            "event": "inject", "mode": "context", "text": "VIP customer",
        }

    def test_update_instructions_and_hang_up(self):
        assert update_instructions("Speak French") == {
            "event": "update_instructions", "instructions": "Speak French",
        }
        assert hang_up(reason="resolved") == {"event": "hang_up", "reason": "resolved"}
        assert hang_up() == {"event": "hang_up"}
