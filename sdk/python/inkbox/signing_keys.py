"""
inkbox/signing_keys.py

Org-level webhook signing key management — shared across all Inkbox clients.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping


@dataclass
class SigningKey:
    """Org-level webhook signing key.

    Returned once on creation/rotation — store ``signing_key`` securely.
    """

    signing_key: str
    created_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SigningKey:
        return cls(
            signing_key=d["signing_key"],
            created_at=datetime.fromisoformat(d["created_at"]),
        )


def verify_webhook(
    *,
    payload: bytes,
    headers: Mapping[str, str],
    secret: str,
) -> bool:
    """Verify that an incoming webhook request was sent by Inkbox.

    Args:
        payload: Raw request body bytes (do not parse/re-serialize).
        headers: Request headers mapping (keys are lowercased internally).
        secret:  Your signing key, with or without a ``whsec_`` prefix.

    Returns:
        True if the signature is valid, False otherwise.
    """
    h = {k.lower(): v for k, v in headers.items()}
    signature = h.get("x-inkbox-signature", "")
    request_id = h.get("x-inkbox-request-id", "")
    timestamp = h.get("x-inkbox-timestamp", "")
    if not signature.startswith("sha256="):
        return False
    key = secret.removeprefix("whsec_")
    message = f"{request_id}.{timestamp}.".encode() + payload
    expected = hmac.new(key.encode(), message, hashlib.sha256).hexdigest()
    received = signature.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


class SigningKeysResource:
    def __init__(self, http: Any) -> None:
        self._http = http

    def create_or_rotate(self) -> SigningKey:
        """Create or rotate the webhook signing key for your organisation.

        The first call creates a new key; subsequent calls rotate (replace) the
        existing key. The plaintext ``signing_key`` is returned **once** —
        store it securely as it cannot be retrieved again.

        Use the returned key to verify ``X-Inkbox-Signature`` headers on
        incoming webhook requests.

        Returns:
            The newly created/rotated signing key with its creation timestamp.
        """
        data = self._http.post("/signing-keys", json={})
        return SigningKey._from_dict(data)
