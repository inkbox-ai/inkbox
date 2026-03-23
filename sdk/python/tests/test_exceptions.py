"""
sdk/python/tests/test_exceptions.py

Tests for SDK exception classes.
"""

from inkbox.phone.exceptions import InkboxAPIError as PhoneAPIError
from inkbox.mail.exceptions import InkboxAPIError as MailAPIError


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

    def test_is_exception(self):
        assert issubclass(MailAPIError, Exception)
