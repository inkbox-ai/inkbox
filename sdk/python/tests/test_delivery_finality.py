"""Delivery state is server-owned and safe across mixed API versions."""

from typing import NotRequired, get_args, get_type_hints

import pytest

from inkbox.imessage import IMessage, IMessageConversationSummary, IMessageRecipient
from inkbox.phone import TextConversationSummary, TextMessage, TextMessageRecipient
from inkbox.webhooks import (
    IMessageRecipientWire,
    IMessageWebhookMessage,
    SmsDeliveryStatusWire,
    TextMessageRecipientWire,
    TextWebhookMessage,
)

TIMESTAMP = "2026-01-01T00:00:00Z"
ID = "10000000-0000-0000-0000-000000000001"
IMESSAGE = {
    "id": ID,
    "conversation_id": ID,
    "assignment_id": None,
    "direction": "outbound",
    "remote_number": "+15551234567",
    "message_type": "message",
    "service": "sms",
    "status": "sent",
    "is_read": False,
    "created_at": TIMESTAMP,
    "updated_at": TIMESTAMP,
}
TEXT = {
    "id": ID,
    "direction": "outbound",
    "local_phone_number": "+15557654321",
    "type": "sms",
    "delivery_status": "delivered",
    "is_read": False,
    "created_at": TIMESTAMP,
    "updated_at": TIMESTAMP,
}


@pytest.mark.parametrize(
    "fields,expected",
    [
        ({}, None),
        ({"delivery_final": None}, None),
        ({"delivery_final": False}, False),
        ({"delivery_final": True}, True),
    ],
)
@pytest.mark.parametrize(
    "model,payload",
    [
        (IMessage, IMESSAGE),
        (TextMessage, TEXT),
        (
            IMessageRecipient,
            {"remote_number": "+15551234567", "delivery_status": "sent"},
        ),
        (
            TextMessageRecipient,
            {"recipient_phone_number": "+15551234567", "delivery_status": "delivered"},
        ),
    ],
)
def test_finality_preserves_server_value_without_inference(
    model, payload, fields, expected
):
    assert model._from_dict({**payload, **fields}).delivery_final is expected


def test_nested_recipients_and_legacy_downgrade_are_independent():
    message = IMessage._from_dict(
        {
            **IMESSAGE,
            "delivery_final": False,
            "was_downgraded": False,
            "recipients": [{"remote_number": "+15551234567", "delivery_final": True}],
        }
    )
    assert message.service == "sms"
    assert message.was_downgraded is False
    assert message.delivery_final is False
    assert message.recipients[0].delivery_final is True
    assert IMessage._from_dict(IMESSAGE).was_downgraded is None
    text = TextMessage._from_dict(
        {
            **TEXT,
            "delivery_final": False,
            "recipients": [
                {"recipient_phone_number": "+15551234567", "delivery_final": True}
            ],
        }
    )
    assert text.delivery_final is False
    assert text.recipients[0].delivery_final is True


@pytest.mark.parametrize(
    "model,payload,service,status",
    [
        (IMessageConversationSummary, {"id": ID, "assignment_id": None}, "rcs", "sent"),
        (
            TextConversationSummary,
            {
                "latest_type": "sms",
                "latest_message_at": TIMESTAMP,
                "unread_count": 1,
                "total_count": 2,
            },
            "mms",
            "delivery_unconfirmed",
        ),
    ],
)
@pytest.mark.parametrize("final", [None, False, True])
def test_summaries_keep_outbound_state_when_latest_message_is_inbound(
    model, payload, service, status, final
):
    payload = {**payload, "latest_direction": "inbound"}
    legacy = model._from_dict(payload)
    assert legacy.latest_outbound_service is None
    assert legacy.latest_outbound_status is None
    assert legacy.latest_outbound_delivery_final is None
    row = model._from_dict(
        {
            **payload,
            "latest_outbound_service": service,
            "latest_outbound_status": status,
            "latest_outbound_delivery_final": final,
        }
    )
    assert row.latest_direction == "inbound"
    assert row.latest_outbound_service == service
    assert row.latest_outbound_status == status
    assert row.latest_outbound_delivery_final is final


@pytest.mark.parametrize(
    "model",
    [
        IMessageRecipientWire,
        IMessageWebhookMessage,
        TextMessageRecipientWire,
        TextWebhookMessage,
    ],
)
def test_webhook_finality_is_optional_and_nullable(model):
    assert (
        get_type_hints(model, include_extras=True)["delivery_final"]
        == NotRequired[bool | None]
    )


def test_webhook_compatibility_and_terminal_failure_wire_status():
    assert (
        get_type_hints(IMessageWebhookMessage, include_extras=True)["was_downgraded"]
        == NotRequired[bool | None]
    )
    assert "blocked_spam_filter" in get_args(SmsDeliveryStatusWire)
