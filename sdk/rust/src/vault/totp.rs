//! Client-side TOTP (RFC 6238) implementation.
//!
//! Port of `inkbox/vault/totp.py`. Code generation matches RFC 4226 (HOTP) /
//! RFC 6238 (TOTP) exactly: big-endian 8-byte counter, HMAC over the base32
//! secret, dynamic truncation, and zero-padded decimal modulo `10**digits`.

use base32::Alphabet;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Sha256, Sha512};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

use crate::error::{InkboxError, Result};

/// Hash algorithm for TOTP code generation.
///
/// Values are lowercase to match the `otpauth://` URI convention and the
/// servers `OTPAlgorithm` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TOTPAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl TOTPAlgorithm {
    /// The wire string value (e.g. `"sha1"`).
    pub fn as_str(&self) -> &'static str {
        match self {
            TOTPAlgorithm::Sha1 => "sha1",
            TOTPAlgorithm::Sha256 => "sha256",
            TOTPAlgorithm::Sha512 => "sha512",
        }
    }

    /// Parse from a (case-insensitive) string. Mirrors `TOTPAlgorithm(value)`.
    pub fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "sha1" => Ok(TOTPAlgorithm::Sha1),
            "sha256" => Ok(TOTPAlgorithm::Sha256),
            "sha512" => Ok(TOTPAlgorithm::Sha512),
            other => Err(InkboxError::InvalidArgument(format!(
                "Invalid algorithm: {other:?}. Must be one of: sha1, sha256, sha512"
            ))),
        }
    }
}

fn default_algorithm() -> TOTPAlgorithm {
    TOTPAlgorithm::Sha1
}
fn default_digits() -> u32 {
    6
}
fn default_period() -> u64 {
    30
}

/// A generated TOTP code with timing metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TOTPCode {
    /// The OTP code string (e.g. `"482901"`).
    pub code: String,
    /// Unix timestamp when this code became valid.
    pub period_start: i64,
    /// Unix timestamp when this code expires.
    pub period_end: i64,
    /// Seconds left until expiry.
    pub seconds_remaining: i64,
}

/// TOTP configuration stored inside a [`crate::vault::types::LoginPayload`].
///
/// `algorithm`/`digits`/`period` always serialize (matching Python's
/// `_to_dict`); `issuer`/`account_name` are omitted when absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TOTPConfig {
    /// Base32-encoded shared secret.
    pub secret: String,
    /// Hash algorithm (default `sha1`).
    #[serde(default = "default_algorithm")]
    pub algorithm: TOTPAlgorithm,
    /// Number of digits in the OTP code (6 or 8, default 6).
    #[serde(default = "default_digits")]
    pub digits: u32,
    /// Time step in seconds (30 or 60, default 30).
    #[serde(default = "default_period")]
    pub period: u64,
    /// Optional issuer name (e.g. `"GitHub"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    /// Optional account identifier (e.g. `"user@example.com"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
}

impl TOTPConfig {
    /// Construct and validate a config (mirrors Python's `__post_init__`).
    ///
    /// # Arguments
    /// * `secret` - Base32-encoded shared secret (non-empty).
    /// * `algorithm` - Hash algorithm.
    /// * `digits` - 6 or 8.
    /// * `period` - 30 or 60.
    /// * `issuer` - Optional issuer name.
    /// * `account_name` - Optional account identifier.
    pub fn new(
        secret: impl Into<String>,
        algorithm: TOTPAlgorithm,
        digits: u32,
        period: u64,
        issuer: Option<String>,
        account_name: Option<String>,
    ) -> Result<Self> {
        let config = TOTPConfig {
            secret: secret.into(),
            algorithm,
            digits,
            period,
            issuer,
            account_name,
        };
        config.validate()?;
        Ok(config)
    }

    /// Validate the config's fields (mirrors `__post_init__`).
    pub fn validate(&self) -> Result<()> {
        if self.secret.trim().is_empty() {
            return Err(InkboxError::InvalidArgument(
                "secret must be a non-empty base32 string".into(),
            ));
        }
        b32decode(&self.secret)?; // validate base32
        if self.digits != 6 && self.digits != 8 {
            return Err(InkboxError::InvalidArgument(format!(
                "digits must be 6 or 8, got {}",
                self.digits
            )));
        }
        if self.period != 30 && self.period != 60 {
            return Err(InkboxError::InvalidArgument(format!(
                "period must be 30 or 60, got {}",
                self.period
            )));
        }
        Ok(())
    }

    /// Generate the current TOTP code.
    pub fn generate_code(&self) -> Result<TOTPCode> {
        generate_totp(self)
    }
}

// ---------------------------------------------------------------------------
// Core TOTP generation
// ---------------------------------------------------------------------------

/// Decode a base32 secret, adding padding if needed (RFC 4648, case-insensitive).
///
/// Mirrors Python's `_b32decode`: uppercases, pads to a multiple of 8, then
/// decodes. Returns an error if the secret is not valid base32.
fn b32decode(secret: &str) -> Result<Vec<u8>> {
    // Uppercase and strip any trailing padding, then decode with the unpadded
    // RFC4648 alphabet. Python pads to a multiple of 8 before decoding; the
    // `base32` crate handles the unpadded form directly, so the result is the
    // same byte string for any valid base32 input.
    let upper = secret.to_uppercase();
    let trimmed = upper.trim_end_matches('=');
    let decoded = base32::decode(Alphabet::Rfc4648 { padding: false }, trimmed);
    match decoded {
        // Reject empty/invalid secrets (Python raises on these too).
        Some(bytes) if !bytes.is_empty() => Ok(bytes),
        _ => Err(InkboxError::InvalidArgument(format!(
            "Invalid base32 secret (length={})",
            secret.len()
        ))),
    }
}

/// Compute the HMAC digest for the given algorithm over `msg` keyed by `key`.
fn hmac_digest(algorithm: TOTPAlgorithm, key: &[u8], msg: &[u8]) -> Vec<u8> {
    match algorithm {
        TOTPAlgorithm::Sha1 => {
            let mut mac = Hmac::<Sha1>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(msg);
            mac.finalize().into_bytes().to_vec()
        }
        TOTPAlgorithm::Sha256 => {
            let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(msg);
            mac.finalize().into_bytes().to_vec()
        }
        TOTPAlgorithm::Sha512 => {
            let mut mac = Hmac::<Sha512>::new_from_slice(key).expect("HMAC accepts any key length");
            mac.update(msg);
            mac.finalize().into_bytes().to_vec()
        }
    }
}

/// Generate an HOTP code per RFC 4226. Internal helper — callers use
/// [`generate_totp`].
fn generate_hotp(
    secret: &str,
    counter: u64,
    algorithm: TOTPAlgorithm,
    digits: u32,
) -> Result<String> {
    let key = b32decode(secret)?;
    // Counter as a big-endian unsigned 64-bit integer (`struct.pack(">Q", ...)`).
    let msg = counter.to_be_bytes();
    let h = hmac_digest(algorithm, &key, &msg);
    // Dynamic truncation: low nibble of the last byte selects the 4-byte window.
    let offset = (h[h.len() - 1] & 0x0f) as usize;
    let code = (((h[offset] as u32) & 0x7f) << 24)
        | (((h[offset + 1] as u32) & 0xff) << 16)
        | (((h[offset + 2] as u32) & 0xff) << 8)
        | ((h[offset + 3] as u32) & 0xff);
    let modulo = 10u32.pow(digits);
    Ok(format!("{:0width$}", code % modulo, width = digits as usize))
}

/// Generate the current TOTP code per RFC 6238.
///
/// # Arguments
/// * `config` - TOTP configuration with the shared secret and parameters.
///
/// # Returns
/// A [`TOTPCode`] with the code and timing metadata.
pub fn generate_totp(config: &TOTPConfig) -> Result<TOTPCode> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| InkboxError::InvalidArgument("system clock before unix epoch".into()))?
        .as_secs();
    let now_int = now as i64;
    let counter = now / config.period;
    let period_start = (counter * config.period) as i64;
    let period_end = period_start + config.period as i64;
    let seconds_remaining = period_end - now_int;

    let code = generate_hotp(&config.secret, counter, config.algorithm, config.digits)?;

    Ok(TOTPCode {
        code,
        period_start,
        period_end,
        seconds_remaining,
    })
}

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

/// Parse an `otpauth://totp/...` URI into a [`TOTPConfig`].
///
/// Supports the Google Authenticator Key URI format. Rejects HOTP URIs.
///
/// # Arguments
/// * `uri` - The full `otpauth://` URI string.
///
/// # Returns
/// A validated [`TOTPConfig`].
pub fn parse_totp_uri(uri: &str) -> Result<TOTPConfig> {
    let parsed = Url::parse(uri)
        .map_err(|_| InkboxError::InvalidArgument(format!("Invalid URI: {uri}")))?;

    // `url` keeps the trailing ':' off the scheme.
    if parsed.scheme() != "otpauth" {
        return Err(InkboxError::InvalidArgument(format!(
            "Invalid scheme: expected 'otpauth', got {:?}",
            parsed.scheme()
        )));
    }

    let otp_type = parsed.host_str().unwrap_or("");
    if otp_type == "hotp" {
        return Err(InkboxError::InvalidArgument(
            "HOTP is not supported — only TOTP URIs are accepted".into(),
        ));
    }
    if otp_type != "totp" {
        return Err(InkboxError::InvalidArgument(format!(
            "Invalid OTP type: expected 'totp', got {otp_type:?}"
        )));
    }

    // Parse label — path is /<label>, label is [Issuer:]AccountName. The
    // `url` crate percent-decodes for us via `path()`; decode explicitly to
    // match Python's `unquote`.
    let raw_path = parsed.path().trim_start_matches('/');
    let label = percent_decode(raw_path);
    let (label_issuer, account_name): (Option<String>, Option<String>) = if label.contains(':') {
        let mut parts = label.splitn(2, ':');
        let issuer = parts.next().unwrap_or("").trim().to_string();
        let account = parts.next().unwrap_or("").trim().to_string();
        (Some(issuer), Some(account))
    } else {
        let trimmed = label.trim();
        (
            None,
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            },
        )
    };

    // Helper: first value for a query key, or None.
    let get_param = |key: &str| -> Option<String> {
        parsed
            .query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };

    // Secret (required)
    let secret = match get_param("secret") {
        Some(s) if !s.is_empty() => s,
        _ => {
            return Err(InkboxError::InvalidArgument(
                "Missing required 'secret' parameter".into(),
            ))
        }
    };
    let secret = secret.to_uppercase();
    b32decode(&secret)?; // validate

    // Issuer — query param takes precedence over label prefix.
    let issuer = get_param("issuer").or(label_issuer);

    // Algorithm
    let algorithm_str = get_param("algorithm").unwrap_or_else(|| "sha1".into());
    let algorithm = TOTPAlgorithm::from_str(&algorithm_str)?;

    // Digits
    let digits_str = get_param("digits").unwrap_or_else(|| "6".into());
    let digits: u32 = digits_str
        .parse()
        .map_err(|_| InkboxError::InvalidArgument(format!("Invalid digits: {digits_str:?}")))?;
    if digits != 6 && digits != 8 {
        return Err(InkboxError::InvalidArgument(format!(
            "Invalid digits: {digits}. Must be 6 or 8"
        )));
    }

    // Period
    let period_str = get_param("period").unwrap_or_else(|| "30".into());
    let period: u64 = period_str
        .parse()
        .map_err(|_| InkboxError::InvalidArgument(format!("Invalid period: {period_str:?}")))?;
    if period != 30 && period != 60 {
        return Err(InkboxError::InvalidArgument(format!(
            "Invalid period: {period}. Must be 30 or 60"
        )));
    }

    TOTPConfig::new(secret, algorithm, digits, period, issuer, account_name)
}

/// Minimal percent-decoder for the URI label (Python's `unquote`). The `url`
/// crate already decodes `path()`, but `otpauth` labels can contain encoded
/// colons/spaces; decode any residual `%XX` sequences to be safe.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------------------
// Tests
//
// Exact mimics of the Python (`tests/test_vault_totp.py`) and TypeScript
// (`tests/vault/totp.test.ts`) suites, ported to the Rust API — same RFC 4226 /
// RFC 6238 vectors and the same URI-parsing cases.
//
// Python/TS mock the clock to assert the time=59 / time=1111111109 RFC 6238
// vectors through `generate_totp`. Rust reads `SystemTime::now()` directly and
// can't be mocked, so those two vectors are driven through the deterministic
// `generate_hotp` at the equivalent counter (`time / period`) — identical math,
// identical expected codes.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // RFC 6238 appendix B secret: ASCII "12345678901234567890".
    const RFC_SECRET_SHA1: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    // ---- TOTPAlgorithm (TestTOTPAlgorithm) ----

    #[test]
    fn algorithm_values() {
        assert_eq!(TOTPAlgorithm::Sha1.as_str(), "sha1");
        assert_eq!(TOTPAlgorithm::Sha256.as_str(), "sha256");
        assert_eq!(TOTPAlgorithm::Sha512.as_str(), "sha512");
    }

    #[test]
    fn algorithm_coerce_from_string() {
        assert_eq!(TOTPAlgorithm::from_str("sha256").unwrap(), TOTPAlgorithm::Sha256);
    }

    // ---- TOTPConfig (TestTOTPConfig) ----

    #[test]
    fn config_defaults() {
        // Mirrors test_from_dict_defaults: a minimal payload uses the defaults.
        let c: TOTPConfig = serde_json::from_value(json!({"secret": "JBSWY3DPEHPK3PXP"})).unwrap();
        assert_eq!(c.algorithm, TOTPAlgorithm::Sha1);
        assert_eq!(c.digits, 6);
        assert_eq!(c.period, 30);
        assert!(c.issuer.is_none());
        assert!(c.account_name.is_none());
    }

    #[test]
    fn config_all_fields() {
        let c = TOTPConfig::new(
            "JBSWY3DPEHPK3PXP",
            TOTPAlgorithm::Sha256,
            8,
            60,
            Some("GitHub".into()),
            Some("user@example.com".into()),
        )
        .unwrap();
        assert_eq!(c.algorithm, TOTPAlgorithm::Sha256);
        assert_eq!(c.digits, 8);
        assert_eq!(c.period, 60);
    }

    #[test]
    fn config_invalid_digits() {
        let e = TOTPConfig::new("JBSWY3DPEHPK3PXP", TOTPAlgorithm::Sha1, 7, 30, None, None)
            .unwrap_err();
        assert!(e.to_string().contains("digits must be 6 or 8"));
    }

    #[test]
    fn config_invalid_period() {
        let e = TOTPConfig::new("JBSWY3DPEHPK3PXP", TOTPAlgorithm::Sha1, 6, 45, None, None)
            .unwrap_err();
        assert!(e.to_string().contains("period must be 30 or 60"));
    }

    #[test]
    fn config_to_dict_omits_none() {
        let c = TOTPConfig::new("JBSWY3DPEHPK3PXP", TOTPAlgorithm::Sha1, 6, 30, None, None).unwrap();
        let d = serde_json::to_value(&c).unwrap();
        assert!(d.get("issuer").is_none());
        assert!(d.get("account_name").is_none());
        assert_eq!(d["secret"], "JBSWY3DPEHPK3PXP");
        assert_eq!(d["algorithm"], "sha1");
        assert_eq!(d["digits"], 6);
        assert_eq!(d["period"], 30);
    }

    #[test]
    fn config_to_dict_includes_optionals() {
        let c = TOTPConfig::new(
            "JBSWY3DPEHPK3PXP",
            TOTPAlgorithm::Sha1,
            6,
            30,
            Some("GitHub".into()),
            Some("user@example.com".into()),
        )
        .unwrap();
        let d = serde_json::to_value(&c).unwrap();
        assert_eq!(d["issuer"], "GitHub");
        assert_eq!(d["account_name"], "user@example.com");
    }

    #[test]
    fn config_from_dict_roundtrip() {
        let original = TOTPConfig::new(
            "JBSWY3DPEHPK3PXP",
            TOTPAlgorithm::Sha256,
            8,
            60,
            Some("GitHub".into()),
            Some("user@example.com".into()),
        )
        .unwrap();
        let d = serde_json::to_value(&original).unwrap();
        let restored: TOTPConfig = serde_json::from_value(d).unwrap();
        assert_eq!(restored.secret, original.secret);
        assert_eq!(restored.algorithm, original.algorithm);
        assert_eq!(restored.digits, original.digits);
        assert_eq!(restored.period, original.period);
        assert_eq!(restored.issuer, original.issuer);
        assert_eq!(restored.account_name, original.account_name);
    }

    // ---- b32decode (TestB32Decode) ----

    #[test]
    fn b32_valid_secret() {
        assert_eq!(
            b32decode("JBSWY3DPEHPK3PXP").unwrap(),
            b"Hello!\xde\xad\xbe\xef".to_vec()
        );
    }

    #[test]
    fn b32_lowercase_normalized() {
        assert_eq!(
            b32decode("jbswy3dpehpk3pxp").unwrap(),
            b32decode("JBSWY3DPEHPK3PXP").unwrap()
        );
    }

    #[test]
    fn b32_invalid_secret() {
        let e = b32decode("!!!invalid!!!").unwrap_err();
        assert!(e.to_string().contains("Invalid base32"));
    }

    // ---- generate_hotp: RFC 4226 appendix D vectors (TestGenerateHOTP) ----

    #[test]
    fn hotp_rfc4226_vectors() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583",
            "399871", "520489",
        ];
        for (counter, want) in expected.iter().enumerate() {
            let got = generate_hotp(RFC_SECRET_SHA1, counter as u64, TOTPAlgorithm::Sha1, 6).unwrap();
            assert_eq!(&got, want, "counter={counter}");
        }
    }

    // ---- generate_totp (TestGenerateTOTP) ----

    #[test]
    fn totp_returns_code() {
        let config = TOTPConfig::new(RFC_SECRET_SHA1, TOTPAlgorithm::Sha1, 6, 30, None, None).unwrap();
        let result = generate_totp(&config).unwrap();
        assert_eq!(result.code.len(), 6);
        assert!(result.code.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn totp_timing_metadata() {
        let config = TOTPConfig::new(RFC_SECRET_SHA1, TOTPAlgorithm::Sha1, 6, 30, None, None).unwrap();
        let result = generate_totp(&config).unwrap();
        assert_eq!(result.period_end - result.period_start, 30);
        assert!(result.seconds_remaining > 0 && result.seconds_remaining <= 30);
    }

    #[test]
    fn totp_8_digit_code() {
        let config = TOTPConfig::new(RFC_SECRET_SHA1, TOTPAlgorithm::Sha1, 8, 30, None, None).unwrap();
        assert_eq!(generate_totp(&config).unwrap().code.len(), 8);
    }

    #[test]
    fn totp_60_second_period() {
        let config = TOTPConfig::new(RFC_SECRET_SHA1, TOTPAlgorithm::Sha1, 6, 60, None, None).unwrap();
        let result = generate_totp(&config).unwrap();
        assert_eq!(result.period_end - result.period_start, 60);
    }

    #[test]
    fn totp_generate_code_method() {
        let config = TOTPConfig::new(RFC_SECRET_SHA1, TOTPAlgorithm::Sha1, 6, 30, None, None).unwrap();
        let result = config.generate_code().unwrap();
        assert_eq!(result.code.len(), 6);
    }

    #[test]
    fn totp_known_time_sha1() {
        // RFC 6238 vector: time=59, SHA1, 8 digits -> 94287082.
        // counter = 59 / 30 = 1.
        assert_eq!(
            generate_hotp(RFC_SECRET_SHA1, 1, TOTPAlgorithm::Sha1, 8).unwrap(),
            "94287082"
        );
    }

    #[test]
    fn totp_known_time_sha1_large() {
        // RFC 6238 vector: time=1111111109, SHA1, 8 digits -> 07081804.
        // counter = 1111111109 / 30 = 37037036.
        assert_eq!(
            generate_hotp(RFC_SECRET_SHA1, 37037036, TOTPAlgorithm::Sha1, 8).unwrap(),
            "07081804"
        );
    }

    // ---- parse_totp_uri (TestParseTotpUri) ----

    #[test]
    fn parse_full_uri() {
        let uri = "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60";
        let config = parse_totp_uri(uri).unwrap();
        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(config.issuer.as_deref(), Some("GitHub"));
        assert_eq!(config.account_name.as_deref(), Some("user@example.com"));
        assert_eq!(config.algorithm, TOTPAlgorithm::Sha256);
        assert_eq!(config.digits, 8);
        assert_eq!(config.period, 60);
    }

    #[test]
    fn parse_minimal_uri() {
        let config = parse_totp_uri("otpauth://totp/?secret=JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(config.algorithm, TOTPAlgorithm::Sha1);
        assert_eq!(config.digits, 6);
        assert_eq!(config.period, 30);
        assert!(config.issuer.is_none());
    }

    #[test]
    fn parse_issuer_in_label_only() {
        let config = parse_totp_uri("otpauth://totp/MyApp:alice?secret=JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(config.issuer.as_deref(), Some("MyApp"));
        assert_eq!(config.account_name.as_deref(), Some("alice"));
    }

    #[test]
    fn parse_issuer_param_overrides_label() {
        let config =
            parse_totp_uri("otpauth://totp/OldIssuer:alice?secret=JBSWY3DPEHPK3PXP&issuer=NewIssuer")
                .unwrap();
        assert_eq!(config.issuer.as_deref(), Some("NewIssuer"));
    }

    #[test]
    fn parse_secret_uppercased() {
        let config = parse_totp_uri("otpauth://totp/?secret=jbswy3dpehpk3pxp").unwrap();
        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn parse_rejects_hotp() {
        let e = parse_totp_uri("otpauth://hotp/?secret=JBSWY3DPEHPK3PXP&counter=0").unwrap_err();
        assert!(e.to_string().contains("HOTP is not supported"));
    }

    #[test]
    fn parse_rejects_invalid_scheme() {
        let e = parse_totp_uri("https://example.com/totp?secret=JBSWY3DPEHPK3PXP").unwrap_err();
        assert!(e.to_string().contains("Invalid scheme"));
    }

    #[test]
    fn parse_rejects_missing_secret() {
        let e = parse_totp_uri("otpauth://totp/?issuer=GitHub").unwrap_err();
        assert!(e.to_string().contains("Missing required 'secret'"));
    }

    #[test]
    fn parse_rejects_invalid_algorithm() {
        let e = parse_totp_uri("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=MD5").unwrap_err();
        assert!(e.to_string().contains("Invalid algorithm"));
    }

    #[test]
    fn parse_rejects_invalid_digits() {
        let e = parse_totp_uri("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&digits=7").unwrap_err();
        assert!(e.to_string().contains("Invalid digits"));
    }

    #[test]
    fn parse_rejects_invalid_period() {
        let e = parse_totp_uri("otpauth://totp/?secret=JBSWY3DPEHPK3PXP&period=45").unwrap_err();
        assert!(e.to_string().contains("Invalid period"));
    }

    #[test]
    fn parse_rejects_invalid_base32_secret() {
        let e = parse_totp_uri("otpauth://totp/?secret=!!!invalid!!!").unwrap_err();
        assert!(e.to_string().contains("Invalid base32"));
    }
}
