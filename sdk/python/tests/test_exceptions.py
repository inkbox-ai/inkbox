"""
sdk/python/tests/test_exceptions.py

Tests for SDK exception classes, including typed 409 subclasses and the
widened ``InkboxAPIError.detail`` union.
"""

import httpx
import pytest

from inkbox._http import _raise_for_status
from inkbox.exceptions import (
    DedicatedIMessageLineInventoryPendingError,
    DedicatedIMessageLineQuotaExceededError,
    DuplicateContactRuleError,
    InkboxAPIError,
    RecipientBlockedError,
    RedundantContactAccessGrantError,
    StorageLimitExceededError,
)
from inkbox.identities.exceptions import (
    HandleUnavailableError,
    map_identity_conflict_error,
)
from inkbox.mail.exceptions import InkboxAPIError as MailAPIError
from inkbox.phone.exceptions import InkboxAPIError as PhoneAPIError


def _resp(status: int, body: dict | str) -> httpx.Response:
    if isinstance(body, dict):
        return httpx.Response(status_code=status, json=body)
    return httpx.Response(status_code=status, text=body)


class TestPhoneInkboxAPIError:
    def test_message_format(self):
        err = PhoneAPIError(404, "not found")
        assert str(err) == "HTTP 404: not found"

    def test_attributes(self):
        err = PhoneAPIError(422, "validation error")
        assert err.status_code == 422
        assert err.detail == "validation error"

    def test_is_exception(self):
        assert issubclass(PhoneAPIError, Exception)


class TestMailInkboxAPIError:
    def test_message_format(self):
        err = MailAPIError(500, "server error")
        assert str(err) == "HTTP 500: server error"

    def test_attributes(self):
        err = MailAPIError(403, "forbidden")
        assert err.status_code == 403
        assert err.detail == "forbidden"


class TestDetailUnion:
    def test_string_detail_round_trips(self):
        err = InkboxAPIError(400, "bad input")
        assert err.detail == "bad input"
        assert isinstance(err.detail, str)

    def test_dict_detail_round_trips(self):
        err = InkboxAPIError(409, {"error": "x", "detail": "y"})
        assert isinstance(err.detail, dict)
        assert err.detail["error"] == "x"


class TestRaiseForStatusPlainString:
    def test_plain_string_409_stays_base_class(self):
        resp = _resp(409, {"detail": "Access already granted"})
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        err = info.value
        assert err.status_code == 409
        assert err.detail == "Access already granted"
        assert not isinstance(err, DuplicateContactRuleError)
        assert not isinstance(err, RedundantContactAccessGrantError)


class TestRaiseForStatusStructured:
    def test_duplicate_contact_rule(self):
        rule_id = "aaaa1111-0000-0000-0000-000000000009"
        resp = _resp(
            409,
            {
                "detail": {
                    "existing_rule_id": rule_id,
                    "message": "rule already exists",
                },
            },
        )
        with pytest.raises(DuplicateContactRuleError) as info:
            _raise_for_status(resp)
        err = info.value
        assert str(err.existing_rule_id) == rule_id
        assert err.status_code == 409
        assert isinstance(err.detail, dict)

    def test_redundant_contact_access_grant(self):
        resp = _resp(
            409,
            {
                "detail": {
                    "error": "redundant_grant",
                    "detail": "wildcard already implies this identity",
                },
            },
        )
        with pytest.raises(RedundantContactAccessGrantError) as info:
            _raise_for_status(resp)
        err = info.value
        assert err.error == "redundant_grant"
        assert "wildcard" in err.detail_message


class TestRaiseForStatusRecipientBlocked:
    def test_recipient_blocked_with_rule(self):
        rule_id = "aaaa1111-0000-0000-0000-000000000077"
        resp = _resp(
            403,
            {
                "detail": {
                    "error": "recipient_blocked",
                    "matched_rule_id": rule_id,
                    "address": "+15551234567",
                    "reason": "outbound block rule matched",
                },
            },
        )
        with pytest.raises(RecipientBlockedError) as info:
            _raise_for_status(resp)
        err = info.value
        assert str(err.matched_rule_id) == rule_id
        assert err.address == "+15551234567"
        assert err.reason == "outbound block rule matched"
        assert err.status_code == 403

    def test_recipient_blocked_without_rule(self):
        # filter_mode default block — no specific rule matched.
        resp = _resp(
            403,
            {
                "detail": {
                    "error": "recipient_blocked",
                    "matched_rule_id": None,
                    "address": "+15551234567",
                    "reason": "filter_mode=whitelist with no allow rule",
                },
            },
        )
        with pytest.raises(RecipientBlockedError) as info:
            _raise_for_status(resp)
        assert info.value.matched_rule_id is None

    def test_unrelated_403_stays_base_class(self):
        # recipient_not_opted_in is NOT subclassed — keeps generic InkboxAPIError.
        resp = _resp(
            403,
            {
                "detail": {
                    "error": "recipient_not_opted_in",
                    "message": "not opted in",
                },
            },
        )
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        assert type(info.value) is InkboxAPIError


class TestRaiseForStatusStorageLimitExceeded:
    def test_storage_limit_exceeded(self):
        resp = _resp(
            402,
            {
                "detail": {
                    "error": "storage_limit_exceeded",
                    "message": (
                        "This inbox has reached its storage limit of 2 GiB. "
                        "Delete messages to free space, or upgrade your plan "
                        "for more: https://inkbox.ai/console/organizations?tab=billing"
                    ),
                    "upgrade_url": "https://inkbox.ai/console/organizations?tab=billing",
                    "limit_bytes": 2_147_483_648,
                },
            },
        )
        with pytest.raises(StorageLimitExceededError) as info:
            _raise_for_status(resp)
        err = info.value
        assert err.status_code == 402
        assert err.limit_bytes == 2_147_483_648
        assert err.upgrade_url.endswith("tab=billing")
        assert "storage limit" in err.message
        assert isinstance(err.detail, dict)
        assert isinstance(err, InkboxAPIError)

    def test_string_detail_402_stays_base_class(self):
        # Old server: plain-string detail, no discriminator. Degrade, don't crash.
        resp = _resp(402, {"detail": "This inbox has reached its storage limit."})
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        err = info.value
        assert type(err) is InkboxAPIError
        assert not isinstance(err, StorageLimitExceededError)
        assert err.status_code == 402

    def test_unrelated_402_stays_base_class(self):
        # Sibling plan-limit 402s (identities/phone/iMessage) are not this error.
        resp = _resp(402, {"detail": "You've reached your plan's limit of 3 identities."})
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        assert type(info.value) is InkboxAPIError


class TestDedicatedIMessageLineErrors:
    def test_quota_exceeded(self):
        resp = _resp(
            402,
            {
                "detail": {
                    "error": "dedicated_imessage_line_quota_exceeded",
                    "message": "Upgrade to claim another line.",
                    "line_type": "dedicated_outbound",
                    "limit": 2,
                    "current": 2,
                    "upgrade_url": "https://inkbox.ai/console/organizations?tab=billing",
                    "contact_email": "contact@inkbox.ai",
                }
            },
        )

        with pytest.raises(DedicatedIMessageLineQuotaExceededError) as info:
            _raise_for_status(resp)

        err = info.value
        assert err.line_type == "dedicated_outbound"
        assert err.limit == 2
        assert err.current == 2
        assert err.contact_email == "contact@inkbox.ai"

    def test_inventory_pending_prefers_retry_after_header(self):
        resp = httpx.Response(
            status_code=503,
            headers={"Retry-After": "3600"},
            json={
                "detail": {
                    "error": "dedicated_imessage_line_inventory_pending",
                    "message": "Please try again later.",
                    "line_type": "dedicated_inbound",
                    "retry_after_seconds": 86_400,
                }
            },
        )

        with pytest.raises(DedicatedIMessageLineInventoryPendingError) as info:
            _raise_for_status(resp)

        err = info.value
        assert err.line_type == "dedicated_inbound"
        assert err.retry_after_seconds == 3600


class TestIdentityConflictMapping:
    def test_maps_handle_collision(self):
        err = InkboxAPIError(
            409,
            {
                "code": "agent_handle_unavailable",
                "message": "Handle unavailable",
            },
        )

        assert isinstance(map_identity_conflict_error(err), HandleUnavailableError)

    def test_preserves_unrelated_line_conflict(self):
        err = InkboxAPIError(
            409,
            {
                "error": "line_already_attached",
                "message": "Choose another line.",
            },
        )

        assert map_identity_conflict_error(err) is err


class TestRaiseForStatusOtherCodes:
    def test_404_stays_base_class(self):
        resp = _resp(404, {"detail": "not found"})
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        assert type(info.value) is InkboxAPIError

    def test_500_stays_base_class(self):
        resp = _resp(500, "server error")
        with pytest.raises(InkboxAPIError) as info:
            _raise_for_status(resp)
        assert info.value.status_code == 500
