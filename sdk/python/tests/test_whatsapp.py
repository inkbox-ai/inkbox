"""Public WhatsApp ownership, delivery, compatibility, and retry contracts."""

import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from inkbox import Inkbox, AgentIdentity, WhatsAppDeliveryState, WhatsAppMessageStatus
from inkbox.identities.types import _AgentIdentityData
from inkbox.whatsapp import WhatsAppResource
from inkbox.contacts.resources.correspondence import ContactCorrespondenceOptions
from inkbox.contacts.types import CorrespondenceChannel, _parse_correspondence_item
from inkbox.webhook_subscriptions import WebhookSubscriptionsResource

F = json.loads((Path(__file__).parents[3] / "tests/fixtures/whatsapp.json").read_text())
OWNER = F["identity_id"]
CONV = F["conversation"]["id"]
MESSAGE = F["message"]["id"]
MEDIA = F["media"]["id"]


def test_send_owner_query_and_acceptance_not_delivery():
    http = MagicMock()
    http.post.return_value = {"message": F["message"]}
    message = WhatsAppResource(http).send(
        to=["+15555550101"],
        text="Hello",
        media_ids=[MEDIA],
        agent_identity_id=OWNER,
        idempotency_key="logical-send",
    )
    assert message.status == WhatsAppMessageStatus.SENT
    assert message.delivery_state == WhatsAppDeliveryState.UNKNOWN
    assert message.failed_at is None
    http.post.assert_called_once_with(
        "/messages",
        json={"to": ["+15555550101"], "text": "Hello", "media_ids": [MEDIA]},
        params={"agent_identity_id": OWNER},
        headers={"Idempotency-Key": "logical-send", "Prefer": "idempotency-replay"},
    )


def test_uncertainty_reuses_exact_payload_and_key(monkeypatch):
    monkeypatch.setattr("inkbox._message_requests.time.sleep", lambda _: None)
    http = MagicMock()
    http.post.side_effect = [
        httpx.ReadTimeout("lost response"),
        {"message": F["message"]},
    ]
    WhatsAppResource(http).send(
        conversation_id=CONV, media_ids=[MEDIA], idempotency_key="stable"
    )
    assert http.post.call_args_list[0] == http.post.call_args_list[1]
    assert http.post.call_args.kwargs["json"] == {
        "conversation_id": CONV,
        "media_ids": [MEDIA],
    }


@pytest.mark.parametrize(
    "options",
    [
        {},
        {"to": "+15555550101", "conversation_id": CONV, "text": "hi"},
        {"to": [], "text": "hi"},
        {"to": ["+15555550101", "+15555550101"], "text": "hi"},
        {"to": "+15555550101", "text": " "},
        {"to": "+15555550101", "text": "😀" * 4001},
        {"to": "+15555550101", "media_ids": [MEDIA, MEDIA]},
    ],
)
def test_invalid_sends_never_touch_transport(options):
    http = MagicMock()
    with pytest.raises(ValueError):
        WhatsAppResource(http).send(**options)
    http.post.assert_not_called()


def test_reads_and_local_mark_read_keep_owner_and_pagination():
    http = MagicMock()
    resource = WhatsAppResource(http)
    http.get.return_value = F["inbound_message"]
    assert resource.get(MESSAGE, agent_identity_id=OWNER).media[0].url is None
    http.get.assert_called_with(
        f"/messages/{MESSAGE}", params={"agent_identity_id": OWNER}
    )
    http.get.return_value = [F["message"]]
    assert (
        len(
            resource.list(
                agent_identity_id=OWNER,
                conversation_id=CONV,
                limit=10,
                offset=4,
                is_read=False,
                is_blocked=False,
            )
        )
        == 1
    )
    http.get.assert_called_with(
        "/messages",
        params={
            "agent_identity_id": OWNER,
            "conversation_id": CONV,
            "include_groups": False,
            "limit": 10,
            "offset": 4,
            "is_read": False,
            "is_blocked": False,
        },
    )
    http.get.return_value = F["conversation"]
    assert resource.get_conversation(CONV, agent_identity_id=OWNER).participants == [
        "+15555550101"
    ]
    http.get.return_value = [F["conversation_summary"]]
    assert resource.list_conversations(agent_identity_id=OWNER)[0].unread_count == 2
    http.get.return_value = F["media"]
    assert resource.get_media(MEDIA, agent_identity_id=OWNER).url.endswith(
        "temporary=1"
    )
    http.get.assert_called_with(f"/media/{MEDIA}", params={"agent_identity_id": OWNER})
    http.post.return_value = {"conversation_id": CONV, "updated_count": 2}
    assert resource.mark_read(CONV, MESSAGE, agent_identity_id=OWNER).updated_count == 2
    http.post.assert_called_with(
        "/mark-read",
        json={"conversation_id": CONV, "through_message_id": MESSAGE},
        params={"agent_identity_id": OWNER},
    )


def test_upload_is_owned_and_size_bounded():
    http = MagicMock()
    http.post_multipart.return_value = F["media"]
    resource = WhatsAppResource(http)
    assert (
        str(
            resource.upload_media(
                content=b"png",
                filename="image.png",
                content_type="image/png",
                agent_identity_id=OWNER,
            ).id
        )
        == MEDIA
    )
    assert http.post_multipart.call_args.kwargs["params"] == {
        "agent_identity_id": OWNER
    }
    with pytest.raises(ValueError):
        resource.upload_media(content=b"x" * (20 * 1024 * 1024 + 1), filename="large")
    assert http.post_multipart.call_count == 1


def test_stale_disabled_snapshot_does_not_deny_fresh_api_access():
    client = Inkbox(api_key="test-only")
    client.whatsapp._http = MagicMock()
    client.whatsapp._http.post.return_value = {"message": F["message"]}
    data = _AgentIdentityData._from_dict(
        {
            "id": OWNER,
            "organization_id": "org_example",
            "agent_handle": "agent",
            "created_at": F["message"]["created_at"],
            "updated_at": F["message"]["updated_at"],
        }
    )
    identity = AgentIdentity(data, client)
    assert not identity.whatsapp_enabled and identity.whatsapp_number is None
    identity.send_whatsapp(to="+15555550101", text="Hi")
    assert client.whatsapp._http.post.call_args.kwargs["params"] == {
        "agent_identity_id": OWNER
    }
    client._ids_resource._http = MagicMock()
    client._ids_resource._http.get.return_value = {"whatsapp": F["status"]}
    assert identity.get_whatsapp_status().enabled
    client._ids_resource._http.get.return_value = {"imessage": {}}
    assert identity.get_whatsapp_status() is None
    client.close()


def test_correspondence_opt_in_and_new_kind():
    assert (
        ContactCorrespondenceOptions()._to_params()["channels"]
        == "email,sms,imessage,calls,slack"
    )
    assert ContactCorrespondenceOptions(
        channels=[CorrespondenceChannel.WHATSAPP], whatsapp_limit=5
    )._to_params() == {"channels": "whatsapp", "whatsapp_limit": 5}
    item = _parse_correspondence_item(
        {
            "channel": "whatsapp",
            "source_id": MESSAGE,
            "direction": "inbound",
            "occurred_at": F["message"]["created_at"],
            "identity_id": OWNER,
            "status": "received",
            "detail_url": None,
            "conversation_id": CONV,
            "local_number": "+15555550100",
            "remote_number": "+15555550101",
            "participants": ["+15555550101"],
            "is_group": False,
            "text": None,
            "media": {"count": 1},
        }
    )
    assert item.channel == CorrespondenceChannel.WHATSAPP and item.media.count == 1


def test_webhook_prefix_registration():
    http = MagicMock()
    http.post.return_value = {
        "id": OWNER,
        "organization_id": "org_example",
        "mailbox_id": None,
        "phone_number_id": None,
        "url": "https://example.com/hooks",
        "event_types": ["whatsapp.received"],
        "status": "active",
        "created_at": F["message"]["created_at"],
        "updated_at": F["message"]["updated_at"],
    }
    result = WebhookSubscriptionsResource(http).create(
        agent_identity_id=OWNER,
        url="https://example.com/hooks",
        event_types=["whatsapp.received"],
    )
    assert result.event_types == ["whatsapp.received"]


def test_real_multipart_transport_preserves_owner_query():
    from inkbox._http import HttpTransport

    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(201, json=F["media"])

    http = HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp")
    http._client.close()
    http._client = httpx.Client(
        base_url="https://inkbox.ai/api/v1/whatsapp",
        transport=httpx.MockTransport(handler),
    )
    try:
        WhatsAppResource(http).upload_media(
            content=b"png", filename="image.png", agent_identity_id=OWNER
        )
        assert requests[0].url.params["agent_identity_id"] == OWNER
        assert b'name="file"' in requests[0].content
        assert b'filename="image.png"' in requests[0].content
    finally:
        http.close()


def test_effective_limits_are_owned_typed_and_preserve_future_policy_keys():
    http = MagicMock()
    http.get.return_value = F["limits"]
    result = WhatsAppResource(http).get_limits(agent_identity_id=OWNER)
    assert str(result.agent_identity_id) == OWNER
    assert set(vars(result)) == {"agent_identity_id", "limits", "usage"}
    assert result.limits["whatsapp.texts_per_agent_identity_per_24h"] == 1000
    assert result.limits["whatsapp.pre_reply_messages"] == 3
    assert result.limits["whatsapp.pre_reply_max_text_length"] == 159
    assert result.limits["whatsapp.outbound_new_contact_min_interval_seconds"] == 60
    assert result.limits["whatsapp.max_media_bytes"] == 5242880
    assert result.limits["whatsapp.future_limit"] == 7
    assert result.usage == {"whatsapp.texts_per_agent_identity_per_24h": 2}
    http.get.assert_called_once_with("/limits", params={"agent_identity_id": OWNER})

@pytest.mark.parametrize("method", ["list", "list_conversations"])
def test_list_date_filters_and_direct_default(method):
    http = MagicMock()
    http.get.return_value = []
    resource = WhatsAppResource(http)
    getattr(resource, method)(start_datetime="2026-03-08", end_datetime="2026-03-08", tz="America/New_York")
    assert http.get.call_args.kwargs["params"] == {
        "limit": 50, "offset": 0, "include_groups": False,
        "start_datetime": "2026-03-08", "end_datetime": "2026-03-08", "tz": "America/New_York",
    }
    getattr(resource, method)(include_groups=True)
    assert http.get.call_args.kwargs["params"]["include_groups"] is True

@pytest.mark.parametrize("fallback", [True, False])
@pytest.mark.parametrize("quoted", [True, False])
def test_reply_fallback_wire_preserves_legacy_default(fallback, quoted):
    http = MagicMock()
    http.post.return_value = {"message": F["message"]}
    WhatsAppResource(http).send(conversation_id=CONV, text="Reply", reply_to_message_id=MESSAGE if quoted else None,
                               plain_reply_fallback=fallback, idempotency_key="same-operation")
    expected = {"conversation_id": CONV, "text": "Reply"}
    if quoted:
        expected["reply_to_message_id"] = MESSAGE
    if quoted and not fallback:
        expected["plain_reply_fallback"] = False
    assert http.post.call_args.kwargs["json"] == expected
    assert http.post.call_args.kwargs["headers"]["Idempotency-Key"] == "same-operation"


@pytest.mark.parametrize("invalid", [None, 0, 1, "false"])
def test_reply_option_rejects_non_boolean_before_http(invalid):
    http = MagicMock()
    with pytest.raises(ValueError, match="boolean"):
        WhatsAppResource(http).send(to="+15555550101", text="Hello", plain_reply_fallback=invalid)
    http.post.assert_not_called()


@pytest.mark.parametrize("key", [None, "saved-logical-send"])
@pytest.mark.parametrize("malformation", ["missing_message", "invalid_id", "invalid_media"])
def test_post_accept_decode_failure_retains_request_key_without_resend(key, malformation):
    import copy
    body = {"message": copy.deepcopy(F["message"])}
    expected_error = ValueError
    if malformation == "missing_message":
        body = {}
        expected_error = KeyError
    elif malformation == "invalid_id":
        body["message"]["id"] = "not-a-uuid"
    else:
        body["message"]["media"] = None
        expected_error = TypeError
    http = MagicMock()
    http.post.return_value = body
    resource = WhatsAppResource(http)
    with pytest.raises(expected_error) as failure:
        resource.send(conversation_id=CONV, text="One logical message", idempotency_key=key)
    http.post.assert_called_once()
    original = http.post.call_args
    retained = failure.value.idempotency_key
    assert retained == original.kwargs["headers"]["Idempotency-Key"]
    if key is not None:
        assert retained == key
    http.post.return_value = {"message": F["message"]}
    resource.send(conversation_id=CONV, text="One logical message", idempotency_key=retained)
    assert http.post.call_count == 2
    assert http.post.call_args == original
