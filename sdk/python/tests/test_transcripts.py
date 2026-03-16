"""Tests for TranscriptsResource."""

from uuid import UUID

from sample_data import PHONE_TRANSCRIPT_DICT


NUM_ID = "aaaa1111-0000-0000-0000-000000000001"
CALL_ID = "bbbb2222-0000-0000-0000-000000000001"


class TestTranscriptsList:
    def test_returns_transcripts(self, client, transport):
        second = {
            **PHONE_TRANSCRIPT_DICT,
            "id": "cccc3333-0000-0000-0000-000000000002",
            "seq": 1,
            "ts_ms": 3000,
            "party": "remote",
            "text": "I need help with my account.",
        }
        transport.get.return_value = [PHONE_TRANSCRIPT_DICT, second]

        transcripts = client._transcripts.list(NUM_ID, CALL_ID)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/calls/{CALL_ID}/transcripts",
        )
        assert len(transcripts) == 2
        assert transcripts[0].seq == 0
        assert transcripts[0].party == "local"
        assert transcripts[0].text == "Hello, how can I help you?"
        assert transcripts[0].ts_ms == 1500
        assert transcripts[0].call_id == UUID(CALL_ID)
        assert transcripts[1].seq == 1
        assert transcripts[1].party == "remote"

    def test_empty_transcripts(self, client, transport):
        transport.get.return_value = []

        transcripts = client._transcripts.list(NUM_ID, CALL_ID)

        assert transcripts == []
