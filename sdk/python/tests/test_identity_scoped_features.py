"""
sdk/python/tests/test_identity_scoped_features.py

Tests for the identity-scoped contact rules + per-identity signing keys:
- MailIdentityContactRulesResource / PhoneIdentityContactRulesResource
- SigningKeysResource per-identity status/rotate (+ deprecated org-level)
- WebhookSubscriptionsResource.create -> WebhookSubscriptionCreateResponse
- AgentIdentity convenience methods + identity.update filter modes
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from sample_data_identities import IDENTITY_DETAIL_DICT

from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import AgentIdentitySummary, _AgentIdentityData
from inkbox.mail.exceptions import InkboxError
from inkbox.mail.resources.identity_contact_rules import (
    MailIdentityContactRulesResource,
)
from inkbox.mail.types import FilterMode, MailIdentityContactRule
from inkbox.phone.resources.identity_contact_rules import (
    PhoneIdentityContactRulesResource,
)
from inkbox.phone.types import PhoneIdentityContactRule
from inkbox.signing_keys import SigningKey, SigningKeysResource, SigningKeyStatus
from inkbox.webhook_subscriptions import (
    WebhookSubscription,
    WebhookSubscriptionCreateResponse,
    WebhookSubscriptionsResource,
)


_AGENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

MAIL_RULE_DICT = {
    "id": "11111111-1111-1111-1111-111111111111",
    "agent_identity_id": _AGENT_ID,
    "action": "block",
    "match_type": "exact_email",
    "match_target": "spam@example.com",
    "status": "active",
    "created_at": "2026-06-09T12:30:00Z",
    "updated_at": "2026-06-09T12:30:00Z",
}

PHONE_RULE_DICT = {
    "id": "22222222-2222-2222-2222-222222222222",
    "agent_identity_id": _AGENT_ID,
    "action": "block",
    "match_type": "exact_number",
    "match_target": "+14155550199",
    "status": "active",
    "created_at": "2026-06-09T12:30:00Z",
    "updated_at": "2026-06-09T12:30:00Z",
}


# ---------------------------------------------------------------------------
# Mail identity contact-rule resource
# ---------------------------------------------------------------------------


class TestMailIdentityContactRulesResource:
    def _res(self):
        http = MagicMock()
        return MailIdentityContactRulesResource(http), http

    def test_list_path_and_parse(self):
        res, http = self._res()
        http.get.return_value = [MAIL_RULE_DICT]
        rows = res.list("my-agent", action="block")
        http.get.assert_called_once_with(
            "/identities/my-agent/mail-contact-rules", params={"action": "block"}
        )
        assert len(rows) == 1
        assert isinstance(rows[0], MailIdentityContactRule)
        assert rows[0].agent_identity_id == UUID(_AGENT_ID)

    def test_create_path_and_body(self):
        res, http = self._res()
        http.post.return_value = MAIL_RULE_DICT
        res.create(
            "my-agent", action="block", match_type="exact_email",
            match_target="spam@example.com",
        )
        http.post.assert_called_once_with(
            "/identities/my-agent/mail-contact-rules",
            json={
                "action": "block",
                "match_type": "exact_email",
                "match_target": "spam@example.com",
            },
        )

    def test_get_update_delete_paths(self):
        res, http = self._res()
        http.get.return_value = MAIL_RULE_DICT
        http.patch.return_value = MAIL_RULE_DICT
        rid = MAIL_RULE_DICT["id"]
        res.get("my-agent", rid)
        http.get.assert_called_with(f"/identities/my-agent/mail-contact-rules/{rid}")
        res.update("my-agent", rid, status="paused")
        http.patch.assert_called_once_with(
            f"/identities/my-agent/mail-contact-rules/{rid}", json={"status": "paused"}
        )
        res.delete("my-agent", rid)
        http.delete.assert_called_once_with(
            f"/identities/my-agent/mail-contact-rules/{rid}"
        )

    def test_list_all_filters_by_agent_identity_id(self):
        res, http = self._res()
        http.get.return_value = [MAIL_RULE_DICT]
        res.list_all(agent_identity_id=_AGENT_ID)
        http.get.assert_called_once_with(
            "/mail/contact-rules", params={"agent_identity_id": _AGENT_ID}
        )


# ---------------------------------------------------------------------------
# Phone identity contact-rule resource
# ---------------------------------------------------------------------------


class TestPhoneIdentityContactRulesResource:
    def _res(self):
        http = MagicMock()
        return PhoneIdentityContactRulesResource(http), http

    def test_list_path_and_parse(self):
        res, http = self._res()
        http.get.return_value = [PHONE_RULE_DICT]
        rows = res.list("my-agent")
        http.get.assert_called_once_with(
            "/identities/my-agent/phone-contact-rules", params={}
        )
        assert isinstance(rows[0], PhoneIdentityContactRule)
        assert rows[0].agent_identity_id == UUID(_AGENT_ID)

    def test_create_defaults_match_type_exact_number(self):
        res, http = self._res()
        http.post.return_value = PHONE_RULE_DICT
        res.create("my-agent", action="block", match_target="+14155550199")
        http.post.assert_called_once_with(
            "/identities/my-agent/phone-contact-rules",
            json={
                "action": "block",
                "match_type": "exact_number",
                "match_target": "+14155550199",
            },
        )

    def test_list_all_filters_by_agent_identity_id(self):
        res, http = self._res()
        http.get.return_value = [PHONE_RULE_DICT]
        res.list_all(agent_identity_id=_AGENT_ID, action="block")
        http.get.assert_called_once_with(
            "/phone/contact-rules",
            params={"agent_identity_id": _AGENT_ID, "action": "block"},
        )


# ---------------------------------------------------------------------------
# Signing keys (per-identity + deprecated org-level)
# ---------------------------------------------------------------------------


class TestSigningKeysPerIdentity:
    def _res(self):
        http = MagicMock()
        return SigningKeysResource(http), http

    def test_create_or_rotate_with_handle_hits_identity_path(self):
        res, http = self._res()
        http.post.return_value = {
            "signing_key": "sk-fresh", "created_at": "2026-06-09T00:00:00Z",
        }
        key = res.create_or_rotate("my-agent")
        http.post.assert_called_once_with(
            "/identities/my-agent/signing-key", json={}
        )
        assert isinstance(key, SigningKey)
        assert key.signing_key == "sk-fresh"

    def test_create_or_rotate_no_handle_hits_org_path(self):
        res, http = self._res()
        http.post.return_value = {
            "signing_key": "sk-org", "created_at": "2026-06-09T00:00:00Z",
        }
        res.create_or_rotate()
        http.post.assert_called_once_with("/signing-keys", json={})

    def test_get_status_with_handle(self):
        res, http = self._res()
        http.get.return_value = {
            "configured": True, "created_at": "2026-06-09T00:00:00Z",
        }
        status = res.get_status("my-agent")
        http.get.assert_called_once_with("/identities/my-agent/signing-key")
        assert isinstance(status, SigningKeyStatus)
        assert status.configured is True
        assert status.created_at == datetime(2026, 6, 9, tzinfo=timezone.utc)

    def test_get_status_not_configured(self):
        res, http = self._res()
        http.get.return_value = {"configured": False, "created_at": None}
        status = res.get_status("my-agent")
        assert status.configured is False
        assert status.created_at is None

    def test_get_status_no_handle_hits_org_path(self):
        res, http = self._res()
        http.get.return_value = {"configured": True, "created_at": None}
        res.get_status()
        http.get.assert_called_once_with("/signing-keys")


# ---------------------------------------------------------------------------
# Webhook subscription create-response (signing_key + owner_identity_id)
# ---------------------------------------------------------------------------


def _sub_dict(**overrides):
    base = {
        "id": "33333333-3333-3333-3333-333333333333",
        "organization_id": "org_abc",
        "mailbox_id": "44444444-4444-4444-4444-444444444444",
        "phone_number_id": None,
        "agent_identity_id": None,
        "owner_identity_id": _AGENT_ID,
        "url": "https://example.com/hook",
        "event_types": ["message.received"],
        "status": "active",
        "created_at": "2026-06-09T00:00:00Z",
        "updated_at": "2026-06-09T00:00:00Z",
    }
    base.update(overrides)
    return base


class TestWebhookSubscriptionCreateResponse:
    def _res(self):
        http = MagicMock()
        return WebhookSubscriptionsResource(http), http

    def test_create_returns_create_response_with_signing_key(self):
        res, http = self._res()
        http.post.return_value = _sub_dict(signing_key="sk-once")
        result = res.create(
            url="https://example.com/hook",
            event_types=["message.received"],
            mailbox_id="44444444-4444-4444-4444-444444444444",
        )
        assert isinstance(result, WebhookSubscriptionCreateResponse)
        assert result.signing_key == "sk-once"
        assert result.owner_identity_id == UUID(_AGENT_ID)

    def test_create_signing_key_absent_is_none(self):
        res, http = self._res()
        http.post.return_value = _sub_dict()  # no signing_key key
        result = res.create(
            url="https://example.com/hook",
            event_types=["message.received"],
            mailbox_id="44444444-4444-4444-4444-444444444444",
        )
        assert result.signing_key is None

    def test_owner_identity_id_optional_back_compat(self):
        # A server response that predates owner_identity_id must still parse.
        d = _sub_dict()
        del d["owner_identity_id"]
        sub = WebhookSubscription._from_dict(d)
        assert sub.owner_identity_id is None


# ---------------------------------------------------------------------------
# AgentIdentity convenience methods + filter-mode update
# ---------------------------------------------------------------------------


def _identity():
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_phone():
    detail = {**IDENTITY_DETAIL_DICT, "phone_number": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityContactRuleDelegation:
    def test_create_mail_contact_rule_delegates(self):
        identity, inkbox = _identity()
        inkbox._mail_identity_contact_rules.create.return_value = (
            MailIdentityContactRule._from_dict(MAIL_RULE_DICT)
        )
        identity.create_mail_contact_rule(
            action="block", match_type="exact_email", match_target="spam@example.com",
        )
        inkbox._mail_identity_contact_rules.create.assert_called_once_with(
            identity.agent_handle,
            action="block",
            match_type="exact_email",
            match_target="spam@example.com",
        )

    def test_update_mail_contact_rule_only_forwards_set_kwargs(self):
        identity, inkbox = _identity()
        identity.update_mail_contact_rule("rid", status="paused")
        inkbox._mail_identity_contact_rules.update.assert_called_once_with(
            identity.agent_handle, "rid", status="paused",
        )

    def test_list_phone_contact_rules_without_phone_returns_empty(self):
        identity, inkbox = _identity_without_phone()
        inkbox._phone_identity_contact_rules.list.return_value = []
        # List must not prethrow on a phoneless identity: the server requires a
        # phone only for create/get/update/delete, not for list.
        assert identity.list_phone_contact_rules() == []
        inkbox._phone_identity_contact_rules.list.assert_called_once()

    def test_phone_rule_cgud_requires_phone_number(self):
        identity, _ = _identity_without_phone()
        with pytest.raises(InkboxError, match="no phone number"):
            identity.get_phone_contact_rule("rid")
        with pytest.raises(InkboxError, match="no phone number"):
            identity.create_phone_contact_rule(action="block", match_target="+14155550199")
        with pytest.raises(InkboxError, match="no phone number"):
            identity.update_phone_contact_rule("rid", status="paused")
        with pytest.raises(InkboxError, match="no phone number"):
            identity.delete_phone_contact_rule("rid")

    def test_create_phone_contact_rule_delegates(self):
        identity, inkbox = _identity()
        inkbox._phone_identity_contact_rules.create.return_value = (
            PhoneIdentityContactRule._from_dict(PHONE_RULE_DICT)
        )
        identity.create_phone_contact_rule(action="block", match_target="+14155550199")
        inkbox._phone_identity_contact_rules.create.assert_called_once_with(
            identity.agent_handle,
            action="block",
            match_target="+14155550199",
            match_type="exact_number",
        )


class TestAgentIdentitySigningKeyDelegation:
    def test_create_signing_key_delegates(self):
        identity, inkbox = _identity()
        identity.create_signing_key()
        inkbox._signing_keys.create_or_rotate.assert_called_once_with(
            identity.agent_handle
        )

    def test_get_signing_key_status_delegates(self):
        identity, inkbox = _identity()
        identity.get_signing_key_status()
        inkbox._signing_keys.get_status.assert_called_once_with(identity.agent_handle)


class TestAgentIdentityFilterModeUpdate:
    def test_update_sends_filter_modes_and_refreshes_cache(self):
        identity, inkbox = _identity()
        # The server (mirrored) returns the updated summary including the
        # new filter modes; the cache rebuild must carry them.
        updated = AgentIdentitySummary._from_dict(
            {
                "id": str(identity.id),
                "organization_id": identity._data.organization_id,
                "agent_handle": identity.agent_handle,
                "display_name": None,
                "description": None,
                "email_address": None,
                "created_at": "2026-06-09T00:00:00Z",
                "updated_at": "2026-06-09T00:00:00Z",
                "imessage_enabled": False,
                "imessage_filter_mode": "blacklist",
                "mail_filter_mode": "whitelist",
                "phone_filter_mode": "whitelist",
            }
        )
        inkbox._ids_resource.update.return_value = updated

        identity.update(mail_filter_mode="whitelist", phone_filter_mode="whitelist")

        inkbox._ids_resource.update.assert_called_once_with(
            identity.agent_handle,
            mail_filter_mode="whitelist",
            phone_filter_mode="whitelist",
        )
        # Regression: rebuild must not reset the cached modes to default.
        assert identity.mail_filter_mode == FilterMode.WHITELIST
        assert identity.phone_filter_mode == FilterMode.WHITELIST
