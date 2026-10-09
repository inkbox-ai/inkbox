"""Attribution survives transcript and correspondence parsing without editing text."""

import json
from pathlib import Path
from uuid import UUID

from inkbox import PhoneTranscriptSpeaker, PhoneTranscriptSpeakerWire
from inkbox.contacts.types import CorrespondenceTranscriptEntry
from inkbox.phone import PhoneTranscript
from inkbox.webhooks import WebhookTranscriptEntryWire


def test_speaker_snapshots_are_distinct_from_call_side():
    rows = json.loads(
        (Path(__file__).resolve().parents[3] / "tests/fixtures/phone_transcript_speakers.json").read_text()
    )
    turns = [PhoneTranscript._from_dict(row) for row in rows]
    assert turns[0].party == turns[1].party == "remote"
    assert turns[0].speaker is not None and turns[1].speaker is not None
    assert turns[2].speaker is not None
    assert turns[0].speaker.id != turns[1].speaker.id
    assert turns[0].speaker.contact_id == UUID(rows[0]["speaker"]["contact_id"])
    assert turns[2].speaker.kind == "agent"
    assert turns[2].speaker.agent_identity_id == UUID(rows[2]["speaker"]["agent_identity_id"])
    for row, turn in zip(rows, turns):
        assert turn.text == row["text"]
        assert turn.phone_number == row["phone_number"]
        entry = CorrespondenceTranscriptEntry._from_dict(row)
        assert entry.speaker == turn.speaker
        assert entry.phone_number == turn.phone_number
    assert turns[0].phone_number != turns[1].phone_number
    assert turns[2].phone_number is None
    assert turns[3].speaker is None
    assert PhoneTranscript._from_dict({k: v for k, v in rows[3].items() if k != "speaker"}).speaker is None
    assert CorrespondenceTranscriptEntry._from_dict({"marker": "abridged"}).speaker is None


def test_turn_phone_number_is_nullable_and_never_inferred_from_snapshot():
    rows = json.loads(
        (Path(__file__).resolve().parents[3] / "tests/fixtures/phone_transcript_speakers.json").read_text()
    )
    dedicated = {**rows[2], "phone_number": "+14155550102"}
    assert PhoneTranscript._from_dict(dedicated).phone_number == "+14155550102"
    assert CorrespondenceTranscriptEntry._from_dict(dedicated).phone_number == "+14155550102"
    webhook: WebhookTranscriptEntryWire = {"party": "local", "phone_number": None}
    assert webhook["phone_number"] is None
    for row in ({**rows[0], "phone_number": None}, {k: v for k, v in rows[0].items() if k != "phone_number"}):
        assert PhoneTranscript._from_dict(row).phone_number is None
        assert CorrespondenceTranscriptEntry._from_dict(row).phone_number is None
    assert CorrespondenceTranscriptEntry._from_dict({"marker": "abridged"}).phone_number is None


def test_sparse_snapshot_and_webhook_wire_export():
    raw: PhoneTranscriptSpeakerWire = {
        "id": "11111111-1111-5111-8111-111111111111",
        "kind": "human",
    }
    speaker = PhoneTranscriptSpeaker._from_dict(raw)
    assert speaker.name is None
    assert speaker.phone_number is None
    assert speaker.contact_id is None
    assert speaker.agent_identity_id is None
