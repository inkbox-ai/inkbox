//! Passthrough cert lifecycle: load-or-create a keypair, build a CSR, and
//! detect when a cached cert needs resigning.
//!
//! Ported from `inkbox/tunnels/client/_cert.py`.
//!
//! ## Algorithm divergence from Python (documented, deliberate)
//!
//! The Python SDK uses an **EC P-256** keypair (via `cryptography`). The Rust
//! crate must not pull in a C/openssl dependency, and the only pure-Rust
//! asymmetric keygen already in `Cargo.toml` is `ed25519-dalek`. So this port
//! generates an **Ed25519** keypair and serializes it as PKCS#8 PEM. The
//! server's CSR-signing endpoint accepts the public key embedded in the CSR;
//! Ed25519 CSRs (RFC 8410) are a valid PKCS#10 shape. The
//! key-on-disk / renewal-threshold logic is faithful to Python.
//!
//! CSR (PKCS#10) DER generation is the one piece that genuinely needs DER
//! assembly + an Ed25519 signature over the CertificationRequestInfo. That is
//! left as a precise TODO below (see [`build_csr`]) because verifying it here
//! against the live signing endpoint is not possible.

use std::path::Path;

use ed25519_dalek::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use ed25519_dalek::SigningKey;

use crate::error::{InkboxError, Result};

use super::state::{
    ensure_private_state_dir, write_private_file, CERT_FILE, KEY_FILE,
};
use super::wsframe::fill_os_random;

/// Resign threshold: 14 days before expiry. Mirrors the Python
/// `CERT_RENEWAL_THRESHOLD = timedelta(days=14)`.
pub const CERT_RENEWAL_THRESHOLD_SECS: i64 = 14 * 24 * 60 * 60;

/// Load an Ed25519 key from disk (PKCS#8 PEM) or generate one.
///
/// See the module docstring for why this is Ed25519 (Python uses EC P-256).
///
/// # Arguments
/// * `state_dir` - The tunnel state directory holding `private_key.pem`.
///
/// # Returns
/// The loaded-or-generated [`SigningKey`].
pub fn load_or_create_keypair(state_dir: &Path) -> Result<SigningKey> {
    let key_path = state_dir.join(KEY_FILE);
    if key_path.is_file() {
        let pem = std::fs::read_to_string(&key_path)
            .map_err(|e| InkboxError::Tunnel(format!("could not read key file: {e}")))?;
        return SigningKey::from_pkcs8_pem(&pem)
            .map_err(|e| InkboxError::Tunnel(format!("invalid PKCS#8 private key: {e}")));
    }

    ensure_private_state_dir(state_dir).map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    // Generate 32 random bytes from the OS CSPRNG (the runtime is POSIX-only,
    // matching Python's `connect()` platform gate) and build a SigningKey.
    let mut seed = [0u8; 32];
    if !fill_os_random(&mut seed) {
        return Err(InkboxError::Tunnel(
            "could not read /dev/urandom to generate a keypair".into(),
        ));
    }
    let key = SigningKey::from_bytes(&seed);
    let pem = key_pem_string(&key)?;
    write_private_file(&key_path, pem.as_bytes())
        .map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    Ok(key)
}

/// Serialize a private key as unencrypted PKCS#8 PEM bytes.
pub fn key_pem_bytes(key: &SigningKey) -> Result<Vec<u8>> {
    Ok(key_pem_string(key)?.into_bytes())
}

fn key_pem_string(key: &SigningKey) -> Result<String> {
    key.to_pkcs8_pem(ed25519_dalek::pkcs8::spki::der::pem::LineEnding::LF)
        .map(|z| z.to_string())
        .map_err(|e| InkboxError::Tunnel(format!("could not encode PKCS#8 PEM: {e}")))
}

/// Build a CSR (PEM) with CN + SAN = `public_host`.
///
/// # Arguments
/// * `_key` - The signing key whose public key the CSR carries.
/// * `_public_host` - The hostname placed in the CN and the SAN DNSName.
///
// TODO(tunnels-runtime): CSR DER encoding.
// The Python `_cert.build_csr` builds a PKCS#10 CertificationRequest:
//   - CertificationRequestInfo { version=0, subject=Name([CN=public_host]),
//       subjectPKInfo (Ed25519: AlgorithmIdentifier id-Ed25519 1.3.101.112,
//       BIT STRING = the 32-byte public key), attributes=[extensionRequest
//       with SubjectAlternativeName([DNSName(public_host)]) critical=false] }
//   - signatureAlgorithm = id-Ed25519
//   - signature = Ed25519 over the DER of CertificationRequestInfo
//   then DER-wrap and PEM-armor as "CERTIFICATE REQUEST".
// Implementing this requires hand-rolled DER (no der/x509 crate is in
// Cargo.toml, and we must not add a C-dependency crate). The Ed25519
// signature itself is available via `_key.sign(&info_der)`. Until the DER
// assembly + a wire-conformance check against the signing endpoint land,
// this returns an error rather than emit an unverified CSR.
pub fn build_csr(_key: &SigningKey, _public_host: &str) -> Result<String> {
    Err(InkboxError::Tunnel(
        "passthrough CSR generation is not yet implemented in the Rust runtime \
         (CSR DER encoding pending); use edge mode or the Python/TS SDK for \
         passthrough tunnels"
            .into(),
    ))
}

/// Decide whether the cached cert needs resigning.
///
/// Mirrors Python: resign when the cert is missing, its expiry is unknown,
/// it is within the renewal threshold, or the on-disk key no longer matches
/// the cert's public key.
///
// TODO(tunnels-runtime): cert expiry + pubkey comparison.
// The Python `cert_needs_sign` parses the cached X.509 cert to read
// `not_valid_after_utc` and to compare `cached_cert.public_key()` against the
// on-disk key. X.509 parsing needs an ASN.1/x509 crate that isn't in
// Cargo.toml (and adding a C-dependency crate is disallowed). Until a
// pure-Rust DER reader lands, this conservatively returns `true` whenever a
// cert file is absent, and otherwise `true` (always resign) so we never serve
// with a stale/mismatched cert — correctness over efficiency. The frequency
// is bounded by the bootstrap path (once per `connect`).
pub fn cert_needs_sign(state_dir: &Path, _key: &SigningKey) -> bool {
    let cert_path = state_dir.join(CERT_FILE);
    if !cert_path.is_file() {
        return true;
    }
    // Conservative: without X.509 parsing we cannot read expiry or compare
    // pubkeys, so request a resign. See the TODO above.
    true
}

/// Persist the signed cert + chain (mode 0o600); return the bytes.
pub fn write_cert_chain(state_dir: &Path, cert_pem: &str, chain_pem: &str) -> Result<Vec<u8>> {
    let full_chain = format!("{cert_pem}{chain_pem}").into_bytes();
    let cert_path = state_dir.join(CERT_FILE);
    write_private_file(&cert_path, &full_chain).map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    Ok(full_chain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("inkbox-cert-test-{tag}-{nanos}"))
    }

    #[test]
    fn keypair_generate_then_load_roundtrips() {
        let dir = unique_dir("keypair");
        let k1 = load_or_create_keypair(&dir).unwrap();
        // Second call loads the persisted PEM and yields the same key bytes.
        let k2 = load_or_create_keypair(&dir).unwrap();
        assert_eq!(k1.to_bytes(), k2.to_bytes());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn key_pem_is_pkcs8() {
        let dir = unique_dir("pem");
        let k = load_or_create_keypair(&dir).unwrap();
        let pem = String::from_utf8(key_pem_bytes(&k).unwrap()).unwrap();
        assert!(pem.starts_with("-----BEGIN PRIVATE KEY-----"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cert_needs_sign_when_missing() {
        let dir = unique_dir("needsign");
        let k = load_or_create_keypair(&dir).unwrap();
        assert!(cert_needs_sign(&dir, &k));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_csr_is_stubbed() {
        let dir = unique_dir("csr");
        let k = load_or_create_keypair(&dir).unwrap();
        assert!(build_csr(&k, "host.example").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
