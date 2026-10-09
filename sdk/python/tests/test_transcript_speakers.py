"""Attribution survives transcript and correspondence parsing without editing text."""

import json
from pathlib import Path
from uuid import UUID

from inkbox import PhoneTranscriptSpeaker, PhoneTranscriptSpeakerWire
from inkbox.contacts.types import CorrespondenceTranscriptEntry
from inkbox.phone import PhoneTranscript


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
        entry = CorrespondenceTranscriptEntry._from_dict(row)
        assert entry.speaker == turn.speaker
    assert turns[3].speaker is None
    assert PhoneTranscript._from_dict({k: v for k, v in rows[3].items() if k != "speaker"}).speaker is None
    assert CorrespondenceTranscriptEntry._from_dict({"marker": "abridged"}).speaker is None


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
