"""
sdk/python/tests/test_webhook_subscriptions.py

Round-trip + validation coverage for WebhookSubscriptionsResource.
Mocks the HTTP transport with a MagicMock (same pattern as
test_signing_keys.py).
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from inkbox.webhook_subscriptions import (
    WebhookSubscription,
    WebhookSubscriptionsResource,
)

_SUB_ID = "11111111-1111-1111-1111-111111111111"
_MAILBOX_ID = "22222222-2222-2222-2222-222222222222"
_PHONE_ID = "33333333-3333-3333-3333-333333333333"

RAW_SUBSCRIPTION = {
    "id": _SUB_ID,
    "organization_id": "org_test",
    "mailbox_id": _MAILBOX_ID,
    "phone_number_id": None,
    "url": "https://customer.example.com/hook",
    "event_types": ["message.received", "message.bounced"],
    "status": "active",
    "created_at": "2026-04-10T18:00:00+00:00",
    "updated_at": "2026-04-10T18:00:00+00:00",
}


def _resource():
    http = MagicMock()
    return WebhookSubscriptionsResource(http), http


class TestCreate:
    def test_round_trip_with_mailbox(self):
        res, http = _resource()
        http.post.return_value = RAW_SUBSCRIPTION

        sub = res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://customer.example.com/hook",
            event_types=["message.received", "message.bounced"],
        )

        http.post.assert_called_once_with(
            "/webhooks/subscriptions",
            json={
                "url": "https://customer.example.com/hook",
                "event_types": ["message.received", "message.bounced"],
                "mailbox_id": _MAILBOX_ID,
            },
        )
        assert isinstance(sub, WebhookSubscription)
        assert sub.id == UUID(_SUB_ID)
        assert sub.organization_id == "org_test"
        assert sub.mailbox_id == UUID(_MAILBOX_ID)
        assert sub.phone_number_id is None
        assert sub.event_types == ["message.received", "message.bounced"]
        assert sub.status == "active"
        assert sub.created_at == datetime(2026, 4, 10, 18, 0, 0, tzinfo=timezone.utc)

    def test_accepts_uuid_object_for_mailbox_id(self):
        res, http = _resource()
        http.post.return_value = RAW_SUBSCRIPTION

        res.create(
            mailbox_id=UUID(_MAILBOX_ID),
            url="https://x/y",
            event_types=["message.received"],
        )

        _, kwargs = http.post.call_args
        assert kwargs["json"]["mailbox_id"] == _MAILBOX_ID

    def test_accepts_phone_number_for_text_channel(self):
        res, http = _resource()
        http.post.return_value = {
            **RAW_SUBSCRIPTION,
            "mailbox_id": None,
            "phone_number_id": _PHONE_ID,
            "event_types": ["text.received", "text.delivered"],
        }

        sub = res.create(
            phone_number_id=_PHONE_ID,
            url="https://x/y",
            event_types=["text.received", "text.delivered"],
        )

        _, kwargs = http.post.call_args
        assert kwargs["json"]["phone_number_id"] == _PHONE_ID
        assert "mailbox_id" not in kwargs["json"]
        assert sub.phone_number_id == UUID(_PHONE_ID)

    def test_rejects_when_both_fks_provided(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="Exactly one of"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                phone_number_id=_PHONE_ID,
                url="https://x/y",
                event_types=["message.received"],
            )

    def test_rejects_when_no_fk_provided(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="Exactly one of"):
            res.create(
                url="https://x/y",
                event_types=["message.received"],
            )

    def test_rejects_empty_event_types(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="non-empty"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                url="https://x/y",
                event_types=[],
            )

    def test_rejects_duplicate_event_types(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="duplicate"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                url="https://x/y",
                event_types=["message.received", "message.received"],
            )

    def test_rejects_incoming_call_event_type(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="incoming-call action"):
            res.create(
                phone_number_id=_PHONE_ID,
                url="https://x/y",
                event_types=["phone.incoming_call"],
            )

    def test_rejects_none_url(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="url must not be None"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                url=None,  # type: ignore[arg-type]
                event_types=["message.received"],
            )

    def test_rejects_none_event_types(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="event_types must not be None"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                url="https://x/y",
                event_types=None,  # type: ignore[arg-type]
            )


class TestUpdate:
    def test_sends_only_url_when_only_url_provided(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION

        res.update(_SUB_ID, url="https://new/hook")

        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"url": "https://new/hook"},
        )

    def test_sends_event_types_replacement(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION

        res.update(_SUB_ID, event_types=["message.received"])

        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"event_types": ["message.received"]},
        )

    def test_omits_unset_kwargs(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION

        res.update(_SUB_ID)

        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={},
        )

    def test_rejects_empty_event_types(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="non-empty"):
            res.update(_SUB_ID, event_types=[])

    def test_rejects_duplicate_event_types(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="duplicate"):
            res.update(_SUB_ID, event_types=["text.sent", "text.sent"])

    def test_rejects_incoming_call(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="incoming-call action"):
            res.update(_SUB_ID, event_types=["phone.incoming_call"])

    def test_defers_owner_compatibility_to_server(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION
        # The SDK can validate that a replacement contains one event family,
        # but it does not know the existing subscription's owner.
        res.update(_SUB_ID, event_types=["text.received"])
        assert http.patch.called

    def test_rejects_none_url_on_update(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="url must not be None"):
            res.update(_SUB_ID, url=None)  # type: ignore[arg-type]

    def test_rejects_none_event_types_on_update(self):
        res, _ = _resource()
        with pytest.raises(ValueError, match="event_types must not be None"):
            res.update(_SUB_ID, event_types=None)  # type: ignore[arg-type]


class TestList:
    def test_unwraps_subscriptions_envelope_and_passes_filters(self):
        res, http = _resource()
        http.get.return_value = {
            "subscriptions": [
                RAW_SUBSCRIPTION,
                {**RAW_SUBSCRIPTION, "id": "44444444-4444-4444-4444-444444444444"},
            ],
        }

        subs = res.list(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_type="message.received",
        )

        http.get.assert_called_once_with(
            "/webhooks/subscriptions",
            params={
                "mailbox_id": _MAILBOX_ID,
                "url": "https://x/y",
                "event_type": "message.received",
            },
        )
        assert len(subs) == 2
        assert subs[0].id == UUID(_SUB_ID)

    def test_empty_envelope_returns_empty_list(self):
        res, http = _resource()
        http.get.return_value = {"subscriptions": []}
        assert res.list() == []


class TestGetDelete:
    def test_get_passes_id_and_parses_response(self):
        res, http = _resource()
        http.get.return_value = RAW_SUBSCRIPTION
        sub = res.get(_SUB_ID)
        http.get.assert_called_once_with(f"/webhooks/subscriptions/{_SUB_ID}")
        assert sub.id == UUID(_SUB_ID)

    def test_delete_calls_delete_on_path(self):
        res, http = _resource()
        res.delete(_SUB_ID)
        http.delete.assert_called_once_with(f"/webhooks/subscriptions/{_SUB_ID}")


class TestClientWiring:
    def test_inkbox_exposes_webhooks_subscriptions(self, client):
        # The conftest `client` fixture wires _webhook_subscriptions._http
        # to the MagicMock transport.
        assert isinstance(
            client.webhooks.subscriptions,
            WebhookSubscriptionsResource,
        )
        assert client.webhooks is client.webhooks


_IDENTITY_ID = "44444444-4444-4444-4444-444444444444"

RAW_IDENTITY_SUBSCRIPTION = {
    **RAW_SUBSCRIPTION,
    "mailbox_id": None,
    "agent_identity_id": _IDENTITY_ID,
    "event_types": ["imessage.received", "imessage.reaction_received"],
}


class TestAgentIdentityOwner:
    def test_round_trip_with_agent_identity(self):
        res, http = _resource()
        http.post.return_value = RAW_IDENTITY_SUBSCRIPTION

        sub = res.create(
            agent_identity_id=_IDENTITY_ID,
            url="https://customer.example.com/hook",
            event_types=["imessage.received", "imessage.reaction_received"],
        )

        http.post.assert_called_once_with(
            "/webhooks/subscriptions",
            json={
                "url": "https://customer.example.com/hook",
                "event_types": ["imessage.received", "imessage.reaction_received"],
                "agent_identity_id": _IDENTITY_ID,
            },
        )
        assert sub.agent_identity_id == UUID(_IDENTITY_ID)
        assert sub.mailbox_id is None
        assert sub.phone_number_id is None

    def test_accepts_call_ended_on_agent_identity_owner(self):
        res, http = _resource()
        http.post.return_value = {
            **RAW_IDENTITY_SUBSCRIPTION,
            "event_types": ["call.ended"],
        }

        sub = res.create(
            agent_identity_id=_IDENTITY_ID,
            url="https://x.example.com/hook",
            event_types=["call.ended"],
        )

        _, kwargs = http.post.call_args
        assert kwargs["json"]["event_types"] == ["call.ended"]
        assert kwargs["json"]["agent_identity_id"] == _IDENTITY_ID
        assert sub.agent_identity_id == UUID(_IDENTITY_ID)

    def test_accepts_a2a_events_on_agent_identity_owner(self):
        res, http = _resource()
        http.post.return_value = {
            **RAW_IDENTITY_SUBSCRIPTION,
            "event_types": ["a2a.task.created", "a2a.task.message"],
        }

        sub = res.create(
            agent_identity_id=_IDENTITY_ID,
            url="https://x.example.com/hook",
            event_types=["a2a.task.created", "a2a.task.message"],
        )

        assert sub.event_types == ["a2a.task.created", "a2a.task.message"]

    def test_rejects_multiple_owners_including_identity(self):
        res, _http = _resource()
        with pytest.raises(ValueError, match="Exactly one"):
            res.create(
                mailbox_id=_MAILBOX_ID,
                agent_identity_id=_IDENTITY_ID,
                url="https://x.example.com/hook",
                event_types=["imessage.received"],
            )

    def test_list_passes_agent_identity_filter(self):
        res, http = _resource()
        http.get.return_value = {"subscriptions": [RAW_IDENTITY_SUBSCRIPTION]}

        rows = res.list(agent_identity_id=_IDENTITY_ID)

        http.get.assert_called_once_with(
            "/webhooks/subscriptions",
            params={"agent_identity_id": _IDENTITY_ID, "scope": "identity"},
        )
        assert rows[0].agent_identity_id == UUID(_IDENTITY_ID)

    def test_parse_defaults_missing_agent_identity_to_none(self):
        # Older payloads without the key must keep parsing.
        sub = WebhookSubscription._from_dict(RAW_SUBSCRIPTION)
        assert sub.agent_identity_id is None


class TestContextConfig:
    def test_create_includes_context_config_in_body(self):
        res, http = _resource()
        http.post.return_value = {
            **RAW_SUBSCRIPTION,
            "context_config": {"email": {"mode": "count", "count": 10}},
        }
        cfg = {
            "email": {"mode": "count", "count": 10},
            "texts": {"mode": "window", "hours": 24},
        }
        sub = res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_types=["message.received"],
            context_config=cfg,
        )
        _, kwargs = http.post.call_args
        assert kwargs["json"]["context_config"] == cfg
        assert sub.context_config == {"email": {"mode": "count", "count": 10}}

    def test_create_omits_context_config_when_not_passed(self):
        res, http = _resource()
        http.post.return_value = RAW_SUBSCRIPTION
        res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_types=["message.received"],
        )
        _, kwargs = http.post.call_args
        assert "context_config" not in kwargs["json"]

    def test_parse_tolerates_missing_context_config(self):
        sub = WebhookSubscription._from_dict(RAW_SUBSCRIPTION)
        assert sub.context_config is None

    def test_parse_reads_context_config_when_present(self):
        raw = {
            **RAW_SUBSCRIPTION,
            "context_config": {"calls": {"mode": "count", "count": 2}},
        }
        sub = WebhookSubscription._from_dict(raw)
        assert sub.context_config == {"calls": {"mode": "count", "count": 2}}

    def test_update_omitted_context_config_sends_no_key(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION
        res.update(_SUB_ID, url="https://new/hook")
        _, kwargs = http.patch.call_args
        assert "context_config" not in kwargs["json"]

    def test_update_none_context_config_sends_null(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION
        res.update(_SUB_ID, context_config=None)
        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"context_config": None},
        )

    def test_update_dict_context_config_sends_object(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION
        cfg = {"texts": {"mode": "window", "hours": 24}}
        res.update(_SUB_ID, context_config=cfg)
        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"context_config": cfg},
        )

    @pytest.mark.parametrize(
        "bad",
        [
            {"bogus": {"mode": "count", "count": 1}},
            {"email": {"mode": "count", "count": 0}},
            {"email": {"mode": "count", "count": 51}},
            {"email": {"mode": "window", "hours": 0}},
            {"email": {"mode": "window", "hours": 169}},
            {"email": {"mode": "bogus"}},
            {"email": {"count": 5}},
            {"email": {"mode": "count", "count": 5, "extra": 1}},
        ],
    )
    def test_create_rejects_invalid_context_config(self, bad):
        res, _ = _resource()
        with pytest.raises(ValueError):
            res.create(
                mailbox_id=_MAILBOX_ID,
                url="https://x/y",
                event_types=["message.received"],
                context_config=bad,
            )

    def test_validator_allows_none_class_value(self):
        res, http = _resource()
        http.post.return_value = RAW_SUBSCRIPTION
        res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_types=["message.received"],
            context_config={"email": {"mode": "count", "count": 3}, "texts": None},
        )
        _, kwargs = http.post.call_args
        assert kwargs["json"]["context_config"]["texts"] is None


class TestAuthToken:
    def test_create_includes_auth_token_in_body(self):
        res, http = _resource()
        http.post.return_value = {
            **RAW_SUBSCRIPTION,
            "has_auth_token": True,
            "auth_token": "your-endpoint-token",
        }

        sub = res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_types=["message.received"],
            auth_token="your-endpoint-token",
        )

        http.post.assert_called_once_with(
            "/webhooks/subscriptions",
            json={
                "url": "https://x/y",
                "event_types": ["message.received"],
                "mailbox_id": _MAILBOX_ID,
                "auth_token": "your-endpoint-token",
            },
        )
        assert sub.has_auth_token is True
        assert sub.auth_token == "your-endpoint-token"

    def test_create_omits_auth_token_when_none(self):
        res, http = _resource()
        http.post.return_value = RAW_SUBSCRIPTION
        res.create(
            mailbox_id=_MAILBOX_ID,
            url="https://x/y",
            event_types=["message.received"],
        )
        _, kwargs = http.post.call_args
        assert "auth_token" not in kwargs["json"]

    def test_update_sends_auth_token_replacement(self):
        res, http = _resource()
        http.patch.return_value = {**RAW_SUBSCRIPTION, "has_auth_token": True}

        res.update(_SUB_ID, auth_token="your-endpoint-token")

        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"auth_token": "your-endpoint-token"},
        )

    def test_update_none_auth_token_sends_null(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION

        res.update(_SUB_ID, auth_token=None)

        http.patch.assert_called_once_with(
            f"/webhooks/subscriptions/{_SUB_ID}",
            json={"auth_token": None},
        )

    def test_update_omits_auth_token_when_unset(self):
        res, http = _resource()
        http.patch.return_value = RAW_SUBSCRIPTION
        res.update(_SUB_ID, url="https://new/hook")
        _, kwargs = http.patch.call_args
        assert "auth_token" not in kwargs["json"]

    def test_parse_reads_auth_token_fields_when_present(self):
        sub = WebhookSubscription._from_dict(
            {
                **RAW_SUBSCRIPTION,
                "has_auth_token": True,
                "auth_token": "your-endpoint-token",
            },
        )
        assert sub.has_auth_token is True
        assert sub.auth_token == "your-endpoint-token"

    def test_parse_reads_null_auth_token_as_none(self):
        sub = WebhookSubscription._from_dict(
            {**RAW_SUBSCRIPTION, "has_auth_token": False, "auth_token": None},
        )
        assert sub.auth_token is None

    def test_parse_defaults_missing_auth_token_fields(self):
        # Older payloads without the keys must keep parsing.
        sub = WebhookSubscription._from_dict(RAW_SUBSCRIPTION)
        assert sub.has_auth_token is False
        assert sub.auth_token is None


ALL_NOTIFICATION_EVENTS = [
    "message.received",
    "message.sent",
    "message.forwarded",
    "message.delivered",
    "message.bounced",
    "message.failed",
    "text.received",
    "text.sent",
    "text.delivered",
    "text.delivery_failed",
    "text.delivery_unconfirmed",
    "imessage.received",
    "imessage.reaction_received",
    "imessage.sent",
    "imessage.delivered",
    "imessage.delivery_failed",
    "call.ended",
    "a2a.task.created",
    "a2a.task.message",
    "a2a.task.canceled",
    "a2a.sent_task.updated",
]


@pytest.mark.parametrize(
    "selector", ["agent_identity_id", "mailbox_id", "phone_number_id"]
)
def test_all_notification_events_with_context_and_no_channel_lookup(selector):
    res, http = _resource()
    cfg = {"email": {"mode": "count", "count": 2}}
    http.post.return_value = {
        **RAW_SUBSCRIPTION,
        "mailbox_id": None,
        "phone_number_id": None,
        "agent_identity_id": _IDENTITY_ID,
        "owner_identity_id": _IDENTITY_ID,
        "event_types": ALL_NOTIFICATION_EVENTS,
        "context_config": cfg,
    }
    row = res.create(
        **{selector: _IDENTITY_ID},
        url="https://example.com/hook",
        event_types=ALL_NOTIFICATION_EVENTS,
        context_config=cfg,
    )
    http.post.assert_called_once_with(
        "/webhooks/subscriptions",
        json={
            selector: _IDENTITY_ID,
            "url": "https://example.com/hook",
            "event_types": ALL_NOTIFICATION_EVENTS,
            "context_config": cfg,
        },
    )
    http.get.assert_not_called()
    assert row.mailbox_id is None and row.phone_number_id is None
    assert row.event_types == ALL_NOTIFICATION_EVENTS


def test_update_replaces_events_and_preserves_context_tristate():
    res, http = _resource()
    http.patch.return_value = {**RAW_SUBSCRIPTION, "event_types": ALL_NOTIFICATION_EVENTS}
    cfg = {"texts": {"mode": "count", "count": 2}}
    row = res.update(
        _SUB_ID,
        event_types=ALL_NOTIFICATION_EVENTS,
        context_config=cfg,
    )
    http.patch.assert_called_once_with(
        f"/webhooks/subscriptions/{_SUB_ID}",
        json={
            "event_types": ALL_NOTIFICATION_EVENTS,
            "context_config": cfg,
        },
    )
    assert row.event_types == ALL_NOTIFICATION_EVENTS


def test_missing_legacy_response_keys_are_backward_readable():
    raw = {
        k: v
        for k, v in RAW_SUBSCRIPTION.items()
        if k not in ("mailbox_id", "phone_number_id")
    }
    row = WebhookSubscription._from_dict(raw)
    assert row.mailbox_id is None and row.phone_number_id is None


def test_overlap_conflict_is_not_swallowed_or_retried():
    from inkbox.exceptions import InkboxAPIError

    res, http = _resource()
    error = InkboxAPIError(status_code=409, detail="Subscription events overlap an existing destination")
    http.patch.side_effect = error
    with pytest.raises(InkboxAPIError) as caught:
        res.update(_SUB_ID, event_types=["message.received"])
    assert caught.value is error
    assert http.patch.call_count == 1


def test_delivery_history_keeps_original_target_and_replay_state():
    from inkbox.webhook_deliveries import WebhookDelivery

    raw = {
        "id": _SUB_ID,
        "organization_id": "org_test",
        "webhook_subscription_id": _MAILBOX_ID,
        "phone_number_id": None,
        "event_id": "evt_example",
        "event_type": "message.received",
        "url": "https://example.com/hook",
        "request_payload": "{}",
        "is_replay": False,
        "created_at": "2026-09-15T00:00:00+00:00",
    }
    old = WebhookDelivery._from_dict(raw)
    assert old.replayable is False
    current = WebhookDelivery._from_dict(
        {
            **raw,
            "replayable": True,
        }
    )
    assert current.webhook_subscription_id == UUID(_MAILBOX_ID)
    assert current.replayable is True
    unavailable = WebhookDelivery._from_dict(
        {
            **raw,
            "replayable": False,
            "replay_unavailable_reason": "event_not_subscribed",
        }
    )
    assert unavailable.replay_unavailable_reason == "event_not_subscribed"
