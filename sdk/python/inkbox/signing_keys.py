"""
inkbox/signing_keys.py

Per-identity webhook signing key management.

Each agent identity has its own signing key used to verify the webhooks
(and WebSocket upgrades) for that identity's mail / phone / iMessage
traffic. Manage it via ``inkbox.signing_keys.create_or_rotate(handle)`` /
``get_status(handle)``, or the ``identity.create_signing_key()`` /
``identity.get_signing_key_status()`` convenience methods.

The legacy no-arg / org-level calls are kept as deprecated bridges.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping


@dataclass
class SigningKey:
    """
    A webhook signing key.

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


@dataclass
class SigningKeyStatus:
    """
    Status of an identity's webhook signing key.

    ``configured`` is ``True`` once a key exists; ``created_at`` is when
    it was created or last rotated (``None`` when not configured).
    """

    configured: bool
    created_at: datetime | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SigningKeyStatus:
        created_at = d.get("created_at")
        return cls(
            configured=bool(d.get("configured", False)),
            created_at=datetime.fromisoformat(created_at) if created_at else None,
        )


def verify_webhook(
    *,
    payload: bytes,
    headers: Mapping[str, str],
    secret: str,
) -> bool:
    """
    Verify that an incoming webhook request was sent by Inkbox.

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
    expected = hmac.new(
        key=key.encode(),
        msg=message,
        digestmod=hashlib.sha256,
    ).hexdigest()
    received = signature.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


def _identity_path(agent_handle: str) -> str:
    return f"/identities/{agent_handle}/signing-key"


class SigningKeysResource:
    """Webhook signing key management.

    Rides the api-root transport (``{base}/api/v1``) so it can address
    both the per-identity routes (``/identities/{handle}/signing-key``)
    and the deprecated org-level route (``/signing-keys``).
    """

    def __init__(self, http: Any) -> None:
        self._http = http

    def create_or_rotate(self, agent_handle: str | None = None) -> SigningKey:
        """
        Create or rotate a webhook signing key.

        Pass ``agent_handle`` to create/rotate **that identity's** key
        (the forward-looking surface). The first call mints a key;
        subsequent calls rotate (replace) it. The plaintext
        ``signing_key`` is returned **once** — store it securely, it
        cannot be retrieved again.

        .. deprecated::
            Calling with no ``agent_handle`` hits the deprecated org-level
            ``/signing-keys`` route (Sunset 2026-08-31). With an
            agent-scoped API key the server rotates that key's identity;
            with an admin key it returns 409 (``InkboxAPIError``) pointing
            at the per-identity route. Prefer
            ``create_or_rotate(agent_handle)`` or
            ``identity.create_signing_key()``.

        Use the returned key to verify ``X-Inkbox-Signature`` headers on
        incoming webhook requests.

        Returns:
            The newly created/rotated signing key with its creation timestamp.
        """
        path = "/signing-keys" if agent_handle is None else _identity_path(agent_handle)
        data = self._http.post(path, json={})
        return SigningKey._from_dict(data)

    def get_status(self, agent_handle: str | None = None) -> SigningKeyStatus:
        """
        Report whether a signing key is configured.

        Pass ``agent_handle`` for that identity's status (the
        forward-looking surface).

        .. deprecated::
            Calling with no ``agent_handle`` hits the deprecated org-level
            ``/signing-keys`` route (Sunset 2026-08-31): with an
            agent-scoped key it reports that identity's status; with an
            admin key it reports an org-aggregate status (``configured``
            true if any identity in the org has a key). Prefer
            ``get_status(agent_handle)`` or
            ``identity.get_signing_key_status()``.
        """
        path = "/signing-keys" if agent_handle is None else _identity_path(agent_handle)
        data = self._http.get(path)
        return SigningKeyStatus._from_dict(data)
