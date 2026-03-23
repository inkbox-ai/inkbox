"""
sdk/python/tests/test_vault_totp.py

Comprehensive tests for TOTP support: TOTPConfig, TOTPCode, generate_totp,
parse_totp_uri, and LoginPayload integration.
"""

from unittest.mock import patch

import pytest

from inkbox.vault.totp import (
    TOTPAlgorithm,
    TOTPCode,
    TOTPConfig,
    _b32decode,
    _generate_hotp,
    generate_totp,
    parse_totp_uri,
)
from inkbox.vault.types import LoginPayload


# ---- RFC 6238 test vectors ----
# Secret from RFC 6238 appendix B (ASCII "12345678901234567890")
RFC_SECRET_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # base32("12345678901234567890")


class TestTOTPAlgorithm:
    def test_values(self):
        assert TOTPAlgorithm.SHA1 == "sha1"
        assert TOTPAlgorithm.SHA256 == "sha256"
        assert TOTPAlgorithm.SHA512 == "sha512"

    def test_hash_func_returns_callable(self):
        import hashlib
        assert TOTPAlgorithm.SHA1.hash_func is hashlib.sha1
        assert TOTPAlgorithm.SHA256.hash_func is hashlib.sha256
        assert TOTPAlgorithm.SHA512.hash_func is hashlib.sha512

    def test_coerce_from_string(self):
        assert TOTPAlgorithm("sha256") == TOTPAlgorithm.SHA256


class TestTOTPConfig:
    def test_defaults(self):
        config = TOTPConfig(secret="JBSWY3DPEHPK3PXP")
        assert config.algorithm == TOTPAlgorithm.SHA1
        assert config.digits == 6
        assert config.period == 30
        assert config.issuer is None
        assert config.account_name is None

    def test_all_fields(self):
        config = TOTPConfig(
            secret="JBSWY3DPEHPK3PXP",
            algorithm=TOTPAlgorithm.SHA256,
            digits=8,
            period=60,
            issuer="GitHub",
            account_name="user@example.com",
        )
        assert config.algorithm == TOTPAlgorithm.SHA256
        assert config.digits == 8
        assert config.period == 60

    def test_invalid_digits(self):
        with pytest.raises(ValueError, match="digits must be 6 or 8"):
            TOTPConfig(secret="JBSWY3DPEHPK3PXP", digits=7)

    def test_invalid_period(self):
        with pytest.raises(ValueError, match="period must be 30 or 60"):
            TOTPConfig(secret="JBSWY3DPEHPK3PXP", period=45)

    def test_algorithm_coercion_from_string(self):
        config = TOTPConfig(secret="JBSWY3DPEHPK3PXP", algorithm="sha256")  # type: ignore[arg-type]
        assert config.algorithm == TOTPAlgorithm.SHA256

    def test_to_dict_omits_none(self):
        config = TOTPConfig(secret="JBSWY3DPEHPK3PXP")
        d = config._to_dict()
        assert "issuer" not in d
        assert "account_name" not in d
        assert d["secret"] == "JBSWY3DPEHPK3PXP"
        assert d["algorithm"] == "sha1"
        assert d["digits"] == 6
        assert d["period"] == 30

    def test_to_dict_includes_optionals(self):
        config = TOTPConfig(
            secret="JBSWY3DPEHPK3PXP",
            issuer="GitHub",
            account_name="user@example.com",
        )
        d = config._to_dict()
        assert d["issuer"] == "GitHub"
        assert d["account_name"] == "user@example.com"

    def test_from_dict_roundtrip(self):
        original = TOTPConfig(
            secret="JBSWY3DPEHPK3PXP",
            algorithm=TOTPAlgorithm.SHA256,
            digits=8,
            period=60,
            issuer="GitHub",
            account_name="user@example.com",
        )
        d = original._to_dict()
        restored = TOTPConfig._from_dict(d)
        assert restored.secret == original.secret
        assert restored.algorithm == original.algorithm
        assert restored.digits == original.digits
        assert restored.period == original.period
        assert restored.issuer == original.issuer
        assert restored.account_name == original.account_name

    def test_from_dict_defaults(self):
        config = TOTPConfig._from_dict({"secret": "JBSWY3DPEHPK3PXP"})
        assert config.algorithm == TOTPAlgorithm.SHA1
        assert config.digits == 6
        assert config.period == 30


class TestB32Decode:
    def test_valid_secret(self):
        result = _b32decode("JBSWY3DPEHPK3PXP")
        assert result == b"Hello!\xde\xad\xbe\xef"

    def test_auto_padding(self):
        # Same secret without padding should still work
        result = _b32decode("JBSWY3DPEHPK3PXP")
        assert len(result) > 0

    def test_lowercase_normalized(self):
        result = _b32decode("jbswy3dpehpk3pxp")
        assert result == _b32decode("JBSWY3DPEHPK3PXP")

    def test_invalid_secret(self):
        with pytest.raises(ValueError, match="Invalid base32"):
            _b32decode("!!!invalid!!!")


class TestGenerateHOTP:
    """Test the internal HOTP generator with known vectors."""

    def test_rfc4226_vectors(self):
        """RFC 4226 appendix D test vectors for SHA1."""
        secret = RFC_SECRET_SHA1
        expected = [
            "755224", "287082", "359152", "969429", "338314",
            "254676", "287922", "162583", "399871", "520489",
        ]
        for counter, expected_code in enumerate(expected):
            result = _generate_hotp(secret, counter, TOTPAlgorithm.SHA1, 6)
            assert result == expected_code, f"counter={counter}"


class TestGenerateTOTP:
    def test_returns_totp_code(self):
        config = TOTPConfig(secret=RFC_SECRET_SHA1)
        result = generate_totp(config)
        assert isinstance(result, TOTPCode)
        assert len(result.code) == 6
        assert result.code.isdigit()

    def test_timing_metadata(self):
        config = TOTPConfig(secret=RFC_SECRET_SHA1, period=30)
        result = generate_totp(config)
        assert result.period_end - result.period_start == 30
        assert 0 < result.seconds_remaining <= 30

    @patch("inkbox.vault.totp.time.time", return_value=59.0)
    def test_known_time_sha1(self, mock_time):
        """RFC 6238 test vector: time=59, SHA1, 8 digits -> 94287082."""
        config = TOTPConfig(secret=RFC_SECRET_SHA1, digits=8, period=30)
        result = generate_totp(config)
        assert result.code == "94287082"

    @patch("inkbox.vault.totp.time.time", return_value=1111111109.0)
    def test_known_time_sha1_large(self, mock_time):
        """RFC 6238 test vector: time=1111111109, SHA1, 8 digits -> 07081804."""
        config = TOTPConfig(secret=RFC_SECRET_SHA1, digits=8, period=30)
        result = generate_totp(config)
        assert result.code == "07081804"

    def test_8_digit_code(self):
        config = TOTPConfig(secret=RFC_SECRET_SHA1, digits=8)
        result = generate_totp(config)
        assert len(result.code) == 8

    def test_60_second_period(self):
        config = TOTPConfig(secret=RFC_SECRET_SHA1, period=60)
        result = generate_totp(config)
        assert result.period_end - result.period_start == 60

    def test_generate_code_method(self):
        config = TOTPConfig(secret=RFC_SECRET_SHA1)
        result = config.generate_code()
        assert isinstance(result, TOTPCode)


class TestParseTotpUri:
    def test_full_uri(self):
        uri = "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60"
        config = parse_totp_uri(uri)
        assert config.secret == "JBSWY3DPEHPK3PXP"
        assert config.issuer == "GitHub"
        assert config.account_name == "user@example.com"
        assert config.algorithm == TOTPAlgorithm.SHA256
        assert config.digits == 8
        assert config.period == 60

    def test_minimal_uri(self):
        uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP"
        config = parse_totp_uri(uri)
        assert config.secret == "JBSWY3DPEHPK3PXP"
        assert config.algorithm == TOTPAlgorithm.SHA1
        assert config.digits == 6
        assert config.period == 30
        assert config.issuer is None

    def test_issuer_in_label_only(self):
        uri = "otpauth://totp/MyApp:alice?secret=JBSWY3DPEHPK3PXP"
        config = parse_totp_uri(uri)
        assert config.issuer == "MyApp"
        assert config.account_name == "alice"

    def test_issuer_param_overrides_label(self):
        uri = "otpauth://totp/OldIssuer:alice?secret=JBSWY3DPEHPK3PXP&issuer=NewIssuer"
        config = parse_totp_uri(uri)
        assert config.issuer == "NewIssuer"

    def test_secret_uppercased(self):
        uri = "otpauth://totp/?secret=jbswy3dpehpk3pxp"
        config = parse_totp_uri(uri)
        assert config.secret == "JBSWY3DPEHPK3PXP"

    def test_rejects_hotp(self):
        uri = "otpauth://hotp/?secret=JBSWY3DPEHPK3PXP&counter=0"
        with pytest.raises(ValueError, match="HOTP is not supported"):
            parse_totp_uri(uri)

    def test_rejects_invalid_scheme(self):
        uri = "https://example.com/totp?secret=JBSWY3DPEHPK3PXP"
        with pytest.raises(ValueError, match="Invalid scheme"):
            parse_totp_uri(uri)

    def test_rejects_missing_secret(self):
        uri = "otpauth://totp/?issuer=GitHub"
        with pytest.raises(ValueError, match="Missing required 'secret'"):
            parse_totp_uri(uri)

    def test_rejects_invalid_algorithm(self):
        uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=MD5"
        with pytest.raises(ValueError, match="Invalid algorithm"):
            parse_totp_uri(uri)

    def test_rejects_invalid_digits(self):
        uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&digits=7"
        with pytest.raises(ValueError, match="Invalid digits"):
            parse_totp_uri(uri)

    def test_rejects_invalid_period(self):
        uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&period=45"
        with pytest.raises(ValueError, match="Invalid period"):
            parse_totp_uri(uri)

    def test_rejects_invalid_base32_secret(self):
        uri = "otpauth://totp/?secret=!!!invalid!!!"
        with pytest.raises(ValueError, match="Invalid base32"):
            parse_totp_uri(uri)


class TestLoginPayloadWithTOTP:
    """Test LoginPayload serialization roundtrip with the totp field."""

    def test_with_totp(self):
        totp = TOTPConfig(
            secret="JBSWY3DPEHPK3PXP",
            issuer="GitHub",
            account_name="user@example.com",
        )
        payload = LoginPayload(password="secret", username="admin", totp=totp)
        d = payload._to_dict()
        assert "totp" in d
        assert d["totp"]["secret"] == "JBSWY3DPEHPK3PXP"
        assert d["totp"]["issuer"] == "GitHub"
        # None values omitted from nested dict
        assert "account_name" in d["totp"]

    def test_without_totp(self):
        payload = LoginPayload(password="secret", username="admin")
        d = payload._to_dict()
        assert "totp" not in d

    def test_roundtrip_with_totp(self):
        totp = TOTPConfig(
            secret="JBSWY3DPEHPK3PXP",
            algorithm=TOTPAlgorithm.SHA256,
            digits=8,
            period=60,
            issuer="GitHub",
        )
        original = LoginPayload(password="pw", username="u", totp=totp)
        d = original._to_dict()
        restored = LoginPayload._from_dict(d)
        assert restored.totp is not None
        assert restored.totp.secret == "JBSWY3DPEHPK3PXP"
        assert restored.totp.algorithm == TOTPAlgorithm.SHA256
        assert restored.totp.digits == 8
        assert restored.totp.period == 60
        assert restored.totp.issuer == "GitHub"

    def test_roundtrip_without_totp(self):
        original = LoginPayload(password="pw", username="u")
        d = original._to_dict()
        restored = LoginPayload._from_dict(d)
        assert restored.totp is None

    def test_backward_compat_no_totp_field(self):
        """Old payloads without a totp field should parse with totp=None."""
        d = {"password": "pw", "username": "u"}
        payload = LoginPayload._from_dict(d)
        assert payload.totp is None
        assert payload.password == "pw"
        assert payload.username == "u"
