"""
inkbox/vault/totp.py

Client-side TOTP (RFC 6238) implementation.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import struct
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


class TOTPAlgorithm(StrEnum):
    """
    Hash algorithm for TOTP code generation.

    Values are lowercase to match ``otpauth://`` URI convention and the
    servers ``OTPAlgorithm`` enum.
    """

    SHA1 = "sha1"
    SHA256 = "sha256"
    SHA512 = "sha512"

    @property
    def hash_func(self) -> Callable[..., object]:
        """Return the corresponding :mod:`hashlib` constructor."""
        return {
            TOTPAlgorithm.SHA1: hashlib.sha1,
            TOTPAlgorithm.SHA256: hashlib.sha256,
            TOTPAlgorithm.SHA512: hashlib.sha512,
        }[self]


@dataclass
class TOTPCode:
    """
    A generated TOTP code with timing metadata.

    Attributes:
        code: The OTP code string (e.g. ``"482901"``).
        period_start: Unix timestamp when this code became valid.
        period_end: Unix timestamp when this code expires.
        seconds_remaining: Seconds left until expiry.
    """

    code: str
    period_start: int
    period_end: int
    seconds_remaining: int


@dataclass
class TOTPConfig:
    """
    TOTP configuration stored inside a :class:`~inkbox.vault.types.LoginPayload`.

    Attributes:
        secret: Base32-encoded shared secret.
        algorithm: Hash algorithm (default ``sha1``).
        digits: Number of digits in the OTP code (6 or 8, default 6).
        period: Time step in seconds (30 or 60, default 30).
        issuer: Optional issuer name (e.g. ``"GitHub"``).
        account_name: Optional account identifier (e.g. ``"user@example.com"``).
    """

    secret: str
    algorithm: TOTPAlgorithm = TOTPAlgorithm.SHA1
    digits: int = 6
    period: int = 30
    issuer: str | None = None
    account_name: str | None = None

    def __post_init__(self) -> None:
        if not self.secret or not self.secret.strip():
            raise ValueError("secret must be a non-empty base32 string")
        _b32decode(self.secret)  # validate base32
        if self.digits not in (6, 8):
            raise ValueError(f"digits must be 6 or 8, got {self.digits}")
        if self.period not in (30, 60):
            raise ValueError(f"period must be 30 or 60, got {self.period}")
        if not isinstance(self.algorithm, TOTPAlgorithm):
            self.algorithm = TOTPAlgorithm(self.algorithm)

    def _to_dict(self) -> dict[str, Any]:
        """Serialize to a dict, omitting ``None``-valued fields."""
        d: dict[str, Any] = {
            "secret": self.secret,
            "algorithm": self.algorithm.value,
            "digits": self.digits,
            "period": self.period,
        }
        if self.issuer is not None:
            d["issuer"] = self.issuer
        if self.account_name is not None:
            d["account_name"] = self.account_name
        return d

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> TOTPConfig:
        """Reconstruct from a dict."""
        return cls(
            secret=d["secret"],
            algorithm=TOTPAlgorithm(d.get("algorithm", "sha1")),
            digits=d.get("digits", 6),
            period=d.get("period", 30),
            issuer=d.get("issuer"),
            account_name=d.get("account_name"),
        )

    def generate_code(self) -> TOTPCode:
        """Generate the current TOTP code."""
        return generate_totp(self)


# ---------------------------------------------------------------------------
# Core TOTP generation
# ---------------------------------------------------------------------------


def _b32decode(secret: str) -> bytes:
    """Decode a base32 secret, adding padding if needed.

    Raises:
        ValueError: If the secret is not valid base32.
    """
    padded = secret.upper() + "=" * (-len(secret) % 8)
    try:
        return base64.b32decode(padded)
    except Exception:
        raise ValueError(f"Invalid base32 secret: {secret!r}") from None


def _generate_hotp(
    secret: str,
    counter: int,
    algorithm: TOTPAlgorithm = TOTPAlgorithm.SHA1,
    digits: int = 6,
) -> str:
    """Generate an HOTP code per RFC 4226.

    Internal helper — callers should use :func:`generate_totp`.
    """
    key = _b32decode(secret)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, algorithm.hash_func).digest()
    offset = h[-1] & 0x0F
    code = struct.unpack(">I", h[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def generate_totp(config: TOTPConfig) -> TOTPCode:
    """Generate the current TOTP code per RFC 6238.

    Args:
        config: TOTP configuration with the shared secret and parameters.

    Returns:
        A :class:`TOTPCode` with the code and timing metadata.
    """
    now = time.time()
    now_int = int(now)
    counter = now_int // config.period
    period_start = counter * config.period
    period_end = period_start + config.period
    seconds_remaining = period_end - now_int

    code = _generate_hotp(config.secret, counter, config.algorithm, config.digits)

    return TOTPCode(
        code=code,
        period_start=period_start,
        period_end=period_end,
        seconds_remaining=seconds_remaining,
    )


# ---------------------------------------------------------------------------
# URI parsing
# ---------------------------------------------------------------------------

_VALID_DIGITS = {6, 8}
_VALID_PERIODS = {30, 60}


def parse_totp_uri(uri: str) -> TOTPConfig:
    """Parse an ``otpauth://totp/...`` URI into a :class:`TOTPConfig`.

    Supports the `Google Authenticator Key URI format
    <https://github.com/google/google-authenticator/wiki/Key-Uri-Format>`_.

    Args:
        uri: The full ``otpauth://`` URI string.

    Returns:
        A validated :class:`TOTPConfig`.

    Raises:
        ValueError: On invalid scheme, HOTP type, missing secret, or
            invalid parameters.
    """
    parsed = urlparse(uri)

    if parsed.scheme != "otpauth":
        raise ValueError(f"Invalid scheme: expected 'otpauth', got {parsed.scheme!r}")

    otp_type = parsed.hostname
    if otp_type == "hotp":
        raise ValueError("HOTP is not supported — only TOTP URIs are accepted")
    if otp_type != "totp":
        raise ValueError(f"Invalid OTP type: expected 'totp', got {otp_type!r}")

    # Parse label — path is /<label>, label is [Issuer:]AccountName
    label = unquote(parsed.path.lstrip("/"))
    if ":" in label:
        label_issuer, account_name = label.split(":", 1)
        label_issuer = label_issuer.strip()
        account_name = account_name.strip()
    else:
        label_issuer = None
        account_name = label.strip() if label else None

    # Parse query parameters
    params = parse_qs(parsed.query)

    def _get(key: str) -> str | None:
        values = params.get(key)
        return values[0] if values else None

    # Secret (required)
    secret = _get("secret")
    if not secret:
        raise ValueError("Missing required 'secret' parameter")
    secret = secret.upper()
    _b32decode(secret)  # validate

    # Issuer — query param takes precedence over label prefix
    issuer = _get("issuer") or label_issuer

    # Algorithm
    algorithm_str = (_get("algorithm") or "sha1").lower()
    try:
        algorithm = TOTPAlgorithm(algorithm_str)
    except ValueError:
        raise ValueError(
            f"Invalid algorithm: {algorithm_str!r}. "
            f"Must be one of: sha1, sha256, sha512"
        ) from None

    # Digits
    digits_str = _get("digits") or "6"
    try:
        digits = int(digits_str)
    except ValueError:
        raise ValueError(f"Invalid digits: {digits_str!r}") from None
    if digits not in _VALID_DIGITS:
        raise ValueError(f"Invalid digits: {digits}. Must be 6 or 8")

    # Period
    period_str = _get("period") or "30"
    try:
        period = int(period_str)
    except ValueError:
        raise ValueError(f"Invalid period: {period_str!r}") from None
    if period not in _VALID_PERIODS:
        raise ValueError(f"Invalid period: {period}. Must be 30 or 60")

    return TOTPConfig(
        secret=secret,
        algorithm=algorithm,
        digits=digits,
        period=period,
        issuer=issuer,
        account_name=account_name or None,
    )
