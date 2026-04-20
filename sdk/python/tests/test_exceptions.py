"""
sdk/python/tests/test_exceptions.py

Tests for SDK exception classes, including typed 409 subclasses and the
widened ``InkboxAPIError.detail`` union.
"""

import httpx
import pytest

from inkbox._http import _raise_for_status
from inkbox.exceptions import (
    DuplicateContactRuleError,
    InkboxAPIError,
    RedundantContactAccessGrantError,
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
