from typing import NotRequired, get_args, get_origin, get_type_hints
from uuid import UUID

import pytest

from inkbox import MediaTranscription, MessageTranscriptionFinishedWebhookPayload, SlackWebhookData
from inkbox.phone.types import TextMediaItem
from inkbox.imessage.types import IMessageMediaItem
from inkbox.whatsapp import WhatsAppMedia

MEDIA_ID = "00000000-0000-4000-8000-000000000001"


@pytest.mark.parametrize(
    "media_type", [TextMediaItem, IMessageMediaItem, WhatsAppMedia]
)
@pytest.mark.parametrize(
    "status,text,error_code",
    [
        ("pending", None, None),
        ("completed", "Hello", None),
        ("completed", "", None),
        ("failed", None, "transcription_failed"),
        ("skipped", None, "unsupported_audio"),
    ],
)
def test_transcription_results(media_type, status, text, error_code):
    raw = {
        "id": MEDIA_ID,
        "filename": "audio.m4a",
        "content_type": "audio/mp4",
        "size": 42,
        "url": "https://example.com/audio",
        "status": "ready",
        "transcription": {"status": status, "text": text, "error_code": error_code},
    }
    media = media_type._from_dict(raw)
    assert media.id == UUID(MEDIA_ID)
    assert media.transcription == MediaTranscription(status, text, error_code)


@pytest.mark.parametrize(
    "media_type", [TextMediaItem, IMessageMediaItem, WhatsAppMedia]
)
@pytest.mark.parametrize("extra", [{}, {"transcription": None}])
def test_legacy_media(media_type, extra):
    raw = {
        "filename": "image.png",
        "content_type": "image/png",
        "size": 42,
        "url": "https://example.com/image",
        "status": "ready",
        **extra,
    }
    if media_type is WhatsAppMedia:
        raw["id"] = MEDIA_ID
    media = media_type._from_dict(raw)
    assert media.transcription is None
    if media_type is not WhatsAppMedia:
        assert media.id is None


def test_completion_envelope_discriminates_by_channel():
    hints = get_type_hints(MessageTranscriptionFinishedWebhookPayload)
    assert get_args(hints["event_type"]) == ("message.transcription_finished",)
    fields_by_variant = [get_type_hints(variant) for variant in get_args(hints["data"])]
    sources = {get_args(fields["channel"])[0]: fields for fields in fields_by_variant}
    assert sources.keys() == {"text", "imessage", "whatsapp", "slack"}
    projection = {"text": "text_message", "imessage": "message", "whatsapp": "message", "slack": "event"}
    for channel, fields in sources.items():
        assert fields["message_id"] is str
        assert projection[channel] in fields
    slack = sources["slack"]
    for key in ("connection_id", "conversation_id", "message_ts", "thread_ts"):
        assert key in slack
    assert "contacts" not in slack


def test_slack_received_event_carries_the_completion_key():
    hints = get_type_hints(SlackWebhookData, include_extras=True)
    assert get_origin(hints["message_id"]) is NotRequired
    assert get_args(hints["message_id"]) == (str,)
