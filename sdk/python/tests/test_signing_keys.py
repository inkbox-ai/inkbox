"""Tests for SigningKeysResource and verify_webhook."""

import hashlib
import hmac
from datetime import datetime, timezone
from unittest.mock import MagicMock

from inkbox.signing_keys import SigningKey, SigningKeysResource, verify_webhook


SIGNING_KEY_DICT = {
    "signing_key": "sk-test-hmac-secret-abc123",
    "created_at": "2026-03-09T00:00:00Z",
}


def _resource():
    http = MagicMock()
    return SigningKeysResource(http), http


class TestSigningKeysCreateOrRotate:
    def test_calls_correct_endpoint(self):
        res, http = _resource()
        http.post.return_value = SIGNING_KEY_DICT

        res.create_or_rotate()

        http.post.assert_called_once_with("/signing-keys", json={})

    def test_returns_signing_key(self):
        res, http = _resource()
        http.post.return_value = SIGNING_KEY_DICT

        key = res.create_or_rotate()

        assert isinstance(key, SigningKey)
        assert key.signing_key == "sk-test-hmac-secret-abc123"
        assert key.created_at == datetime(2026, 3, 9, 0, 0, 0, tzinfo=timezone.utc)


def _make_signature(key: str, request_id: str, timestamp: str, body: bytes) -> str:
    message = f"{request_id}.{timestamp}.".encode() + body
    digest = hmac.new(key.encode(), message, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


class TestVerifyWebhook:
    KEY = "test-signing-key"
    REQUEST_ID = "req-abc-123"
    TIMESTAMP = "1741737600"
    BODY = b'{"event":"message.received"}'

    def _headers(self, sig: str) -> dict[str, str]:
        return {
            "X-Inkbox-Signature": sig,
            "X-Inkbox-Request-ID": self.REQUEST_ID,
            "X-Inkbox-Timestamp": self.TIMESTAMP,
        }

    def test_valid_signature(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        assert verify_webhook(payload=self.BODY, headers=self._headers(sig), secret=self.KEY)

    def test_valid_signature_with_whsec_prefix(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        assert verify_webhook(payload=self.BODY, headers=self._headers(sig), secret=f"whsec_{self.KEY}")

    def test_headers_are_case_insensitive(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        lowercase_headers = {
            "x-inkbox-signature": sig,
            "x-inkbox-request-id": self.REQUEST_ID,
            "x-inkbox-timestamp": self.TIMESTAMP,
        }
        assert verify_webhook(payload=self.BODY, headers=lowercase_headers, secret=self.KEY)

    def test_wrong_key_returns_false(self):
        sig = _make_signature("wrong-key", self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        assert not verify_webhook(payload=self.BODY, headers=self._headers(sig), secret=self.KEY)

    def test_tampered_body_returns_false(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        assert not verify_webhook(payload=b'{"event":"message.sent"}', headers=self._headers(sig), secret=self.KEY)

    def test_wrong_request_id_returns_false(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        headers = {**self._headers(sig), "X-Inkbox-Request-ID": "different-id"}
        assert not verify_webhook(payload=self.BODY, headers=headers, secret=self.KEY)

    def test_wrong_timestamp_returns_false(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        headers = {**self._headers(sig), "X-Inkbox-Timestamp": "9999999999"}
        assert not verify_webhook(payload=self.BODY, headers=headers, secret=self.KEY)

    def test_missing_sha256_prefix_returns_false(self):
        sig = _make_signature(self.KEY, self.REQUEST_ID, self.TIMESTAMP, self.BODY)
        bare_hex = sig.removeprefix("sha256=")
        assert not verify_webhook(payload=self.BODY, headers=self._headers(bare_hex), secret=self.KEY)

    def test_missing_headers_returns_false(self):
        assert not verify_webhook(payload=self.BODY, headers={}, secret=self.KEY)
