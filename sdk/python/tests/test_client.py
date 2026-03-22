"""
sdk/python/tests/test_client.py

Tests for Inkbox unified client — phone resources.
"""

from inkbox import Inkbox
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.signing_keys import SigningKeysResource


class TestInkboxPhoneResources:
    def test_creates_phone_resource_instances(self):
        client = Inkbox(api_key="sk-test")

        assert isinstance(client._numbers, PhoneNumbersResource)
        assert isinstance(client._calls, CallsResource)
        assert isinstance(client._transcripts, TranscriptsResource)
        assert isinstance(client._signing_keys, SigningKeysResource)

        client.close()

    def test_phone_http_base_url(self):
        client = Inkbox(api_key="sk-test", base_url="http://localhost:8000")
        assert str(client._phone_http._client.base_url) == "http://localhost:8000/api/v1/phone/"
        client.close()
