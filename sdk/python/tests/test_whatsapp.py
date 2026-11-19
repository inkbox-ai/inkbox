"""Public WhatsApp ownership, delivery, compatibility, and retry contracts."""

import json
from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID

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
        to="+15555550101",
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
        json={"to": "+15555550101", "text": "Hello", "media_ids": [MEDIA]},
        params={"agent_identity_id": OWNER},
        headers={"Idempotency-Key": "logical-send", "Prefer": "idempotency-replay"},
    )


def test_voice_note_options_sent_only_when_set():
    http = MagicMock()
    http.post.return_value = {"message": F["message"]}
    resource = WhatsAppResource(http)
    resource.send(
        to="+15555550101", text="Hello", send_as_voice_note=True, fallback_to_text=False
    )
    assert http.post.call_args.kwargs["json"] == {
        "to": "+15555550101",
        "text": "Hello",
        "send_as_voice_note": True,
        "fallback_to_text": False,
    }
    resource.send(to="+15555550101", text="Hello")
    assert http.post.call_args.kwargs["json"] == {"to": "+15555550101", "text": "Hello"}


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
    identity.send_whatsapp(to="+15555550101", text="Hi", send_as_voice_note=True)
    assert client.whatsapp._http.post.call_args.kwargs["json"]["send_as_voice_note"] is True
    client._ids_resource._http = MagicMock()
    client._ids_resource._http.get.return_value = {"whatsapp": F["status"]}
    assert identity.get_whatsapp_status().enabled
    client._ids_resource._http.get.return_value = {"imessage": {}}
    assert identity.get_whatsapp_status() is None
    client.close()


@pytest.mark.parametrize("configured", [True, False, None])
def test_identity_preserves_configured_history_without_enabling_send(configured):
    raw = {
        "id": OWNER,
        "organization_id": "org_example",
        "agent_handle": "agent",
        "created_at": F["message"]["created_at"],
        "updated_at": F["message"]["updated_at"],
        "whatsapp_enabled": False,
        "whatsapp_number": None,
    }
    if configured is not None:
        raw["whatsapp_configured"] = configured
    data = _AgentIdentityData._from_dict(raw)
    with Inkbox(api_key="test-only") as client:
        identity = AgentIdentity(data, client)
        assert data.whatsapp_configured is (configured is True)
        assert identity.whatsapp_configured is (configured is True)
        assert identity.whatsapp_enabled is False
        assert identity.whatsapp_number is None


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
        "limit": 50, "offset": 0,
        "start_datetime": "2026-03-08", "end_datetime": "2026-03-08", "tz": "America/New_York",
    }
    assert "include_groups" not in http.get.call_args.kwargs["params"]

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


@pytest.mark.parametrize("identity_id", [None, OWNER, UUID(OWNER)])
@pytest.mark.parametrize("state", ["ready", "unavailable", "disabled"])
def test_onboarding_is_an_owned_read_and_preserves_availability(identity_id, state):
    from dataclasses import asdict
    from inkbox import WhatsAppOnboarding

    raw = json.loads((Path(__file__).parents[3] / "tests/fixtures/whatsapp-onboarding.json").read_text())
    raw["agent_identity_id"] = OWNER
    raw["ready"] = state == "ready"
    http = MagicMock()
    http.get.return_value = raw
    result = WhatsAppResource(http).get_onboarding(agent_identity_id=identity_id)
    assert isinstance(result, WhatsAppOnboarding)
    assert asdict(result) == {**raw, "agent_identity_id": UUID(OWNER)}
    http.get.assert_called_once_with(
        "/onboarding", params={} if identity_id is None else {"agent_identity_id": OWNER}
    )
    http.post.assert_not_called()


def test_identity_onboarding_reads_fresh_details_with_own_identity():
    data = _AgentIdentityData._from_dict({
        "id": OWNER, "organization_id": "org_example", "agent_handle": "agent",
        "created_at": F["message"]["created_at"], "updated_at": F["message"]["updated_at"],
    })
    with Inkbox(api_key="test-only") as client:
        client.whatsapp._http = MagicMock()
        client.whatsapp._http.get.return_value = {
            "agent_identity_id": OWNER, "triage_number": "+15555550100", "connect_command": "connect @agent",
            "connect_link": "https://wa.me/15555550100?text=connect%20%40agent", "connect_qr_png_data_url": "data:image/png;base64,cXI=", "ready": False,
        }
        assert AgentIdentity(data, client).get_whatsapp_onboarding().ready is False
        client.whatsapp._http.get.assert_called_once_with("/onboarding", params={"agent_identity_id": OWNER})


def test_whatsapp_webhook_companion_metadata_is_optional_and_typed():
    from typing import get_type_hints, get_args, NotRequired
    from inkbox.companion import CompanionMetadata
    from inkbox.webhooks import WhatsAppWebhookPayload

    annotation = get_type_hints(WhatsAppWebhookPayload, include_extras=True)["companion"]
    assert annotation == NotRequired[CompanionMetadata]
    assert get_args(annotation) == (CompanionMetadata,)


@pytest.mark.parametrize("available", [True, False])
def test_legacy_onboarding_retains_direct_draft_without_inventing_router(available):
    http = MagicMock()
    http.get.return_value = {"agent_identity_id": OWNER, "number": "+15555550100" if available else None,
        "message_text": "Hello!", "message_link": "https://wa.me/15555550100?text=Hello!" if available else None,
        "message_qr_png_data_url": "data:image/png;base64,cXI=" if available else None, "ready": available}
    result = WhatsAppResource(http).get_onboarding()
    assert result.number == http.get.return_value["number"]
    assert result.message_text == "Hello!"
    assert result.message_link == http.get.return_value["message_link"]
    assert result.message_qr_png_data_url == http.get.return_value["message_qr_png_data_url"]
    assert result.triage_number is None and result.connect_command is None
    assert result.connect_link is None and result.connect_qr_png_data_url is None


def test_management_router_fence_and_explicit_clear_are_preserved():
    http = MagicMock()
    router = {"id": CONV, "number": "+15555550100", "revision": 2, "state": "enabled",
              "profile_display_name": None, "accepting_new_connections": False}
    http.patch.return_value = {"router": router}
    api = WhatsAppResource(http)
    result = api.update_router(expected_router_id=CONV, expected_revision=1,
                               profile_display_name=None, accepting_new_connections=False)
    assert result.id == UUID(CONV) and result.accepting_new_connections is False
    http.patch.assert_called_once_with("/router", json={"expected_router_id": CONV, "expected_revision": 1,
        "profile_display_name": None, "accepting_new_connections": False})
    http.patch.reset_mock()
    api.update_router(expected_router_id=CONV, expected_revision=2)
    http.patch.assert_called_once_with("/router", json={"expected_router_id": CONV, "expected_revision": 2})
    http.get.return_value = {"router": None}
    assert api.get_router() is None


def test_management_number_detach_and_history_pagination():
    http = MagicMock()
    number = {"id": CONV, "number": "+15555550100", "agent_identity_id": None, "revision": 3,
        "state": "disabled", "binding_state": None, "assignable": False, "unavailable_reason": "Requires setup"}
    api = WhatsAppResource(http)
    http.get.return_value = {"numbers": [number], "has_more": True}
    assert api.list_numbers(offset=100).has_more
    http.get.assert_called_with("/numbers", params={"offset": 100})
    http.patch.return_value = number
    assert api.assign_number(CONV, agent_identity_id=None, expected_revision=2).agent_identity_id is None
    http.patch.assert_called_with(f"/numbers/{CONV}", json={"agent_identity_id": None, "expected_revision": 2})
    http.get.return_value = {"items": [{"remote_number": "+15555550101", "last_message_at": "2026-10-01T12:00:00Z",
                                      "latest_text": "Hello", "message_count": 1}], "has_more": False}
    assert api.list_router_threads(limit=10, offset=20).items[0].message_count == 1
    http.get.assert_called_with("/router/conversations", params={"offset": 20, "limit": 10})
    http.get.return_value = {"items": [{"id": MESSAGE, "direction": "inbound", "content": "Hello",
                                      "status": "received", "created_at": "2026-10-01T12:00:00Z"}], "has_more": False}
    assert api.list_router_messages("+15555550101", offset=10).items[0].id == UUID(MESSAGE)
    http.get.assert_called_with("/router/conversations/+15555550101/messages", params={"offset": 10, "limit": 50})
