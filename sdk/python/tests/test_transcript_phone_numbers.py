"""Per-turn numbers survive parsing without altering spoken text."""

import json
from dataclasses import asdict
from pathlib import Path

from inkbox.contacts.types import CorrespondenceTranscriptEntry
from inkbox.phone import PhoneTranscript
from inkbox.webhooks import WebhookTranscriptEntryWire

ROWS = json.loads(
    (Path(__file__).resolve().parents[3] / "tests/fixtures/phone_transcript_numbers.json").read_text()
)


def test_remote_lines_remain_distinct_and_text_stays_unchanged():
    turns = [PhoneTranscript._from_dict(row) for row in ROWS]
    assert turns[0].party == turns[1].party == "remote"
    assert turns[0].phone_number != turns[1].phone_number
    for row, turn in zip(ROWS, turns):
        assert turn.text == row["text"]
        assert turn.phone_number == row["phone_number"]
        assert set(asdict(turn)) == {
            "id", "call_id", "seq", "ts_ms", "party", "text", "created_at", "phone_number",
        }
        entry = CorrespondenceTranscriptEntry._from_dict(row)
        assert entry.phone_number == turn.phone_number
        assert entry.text == turn.text
    assert turns[2].phone_number is None
    assert turns[3].phone_number is None


def test_dedicated_local_number_and_unavailable_attribution():
    dedicated = {**ROWS[2], "phone_number": "+14155550102"}
    assert PhoneTranscript._from_dict(dedicated).phone_number == "+14155550102"
    assert CorrespondenceTranscriptEntry._from_dict(dedicated).phone_number == "+14155550102"
    webhook: WebhookTranscriptEntryWire = {"party": "local", "phone_number": None}
    assert webhook["phone_number"] is None
    for row in ({**ROWS[0], "phone_number": None}, {k: v for k, v in ROWS[0].items() if k != "phone_number"}):
        assert PhoneTranscript._from_dict(row).phone_number is None
        assert CorrespondenceTranscriptEntry._from_dict(row).phone_number is None
    assert CorrespondenceTranscriptEntry._from_dict({"marker": "abridged"}).phone_number is None
