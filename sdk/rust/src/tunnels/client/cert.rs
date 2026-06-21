//! Passthrough cert lifecycle: load-or-create an EC P-256 keypair, build a
//! PKCS#10 CSR, and detect when a cached cert needs resigning.
//!
//! Ported from `inkbox/tunnels/client/_cert.py` (and `_cert.ts`). All three
//! SDKs use an **EC P-256** keypair, persist the private key as unencrypted
//! PKCS#8 PEM at `{state_dir}/private_key.pem`, and build a CSR whose subject
//! is `CN=<public_host>` with a non-critical `subjectAltName` carrying the
//! same host as a DNSName. Keeping these byte-for-byte compatible means the
//! on-disk state interops across the Python / TS / Rust SDKs.

use std::path::Path;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

// p256 re-exports the RustCrypto PKCS#8 traits; use them so the on-disk
// encoding matches Python's `PrivateFormat.PKCS8` + `NoEncryption`.
use p256::ecdsa::{DerSignature, SigningKey};
use p256::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};

use der::EncodePem;
use spki::{EncodePublicKey, SubjectPublicKeyInfoOwned};
use x509_cert::builder::{Builder, RequestBuilder};
use x509_cert::ext::pkix::name::GeneralName;
use x509_cert::ext::pkix::SubjectAltName;
use x509_cert::name::Name;
use x509_cert::Certificate;

use crate::error::{InkboxError, Result};

use super::state::{ensure_private_state_dir, write_private_file, CERT_FILE, KEY_FILE};

/// Resign threshold: 14 days before expiry. Mirrors the Python
/// `CERT_RENEWAL_THRESHOLD = timedelta(days=14)`.
pub const CERT_RENEWAL_THRESHOLD_SECS: i64 = 14 * 24 * 60 * 60;

/// Load an EC P-256 key from disk (PKCS#8 PEM) or generate one.
///
/// Matches Python: the key lives at `{state_dir}/private_key.pem` as an
/// unencrypted PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`).
///
/// # Arguments
/// * `state_dir` - The tunnel state directory holding `private_key.pem`.
///
/// # Returns
/// The loaded-or-generated [`SigningKey`] (P-256).
pub fn load_or_create_keypair(state_dir: &Path) -> Result<SigningKey> {
    let key_path = state_dir.join(KEY_FILE);
    if key_path.is_file() {
        // Existing key: parse the PKCS#8 PEM straight off disk.
        let pem = std::fs::read_to_string(&key_path)
            .map_err(|e| InkboxError::Tunnel(format!("could not read key file: {e}")))?;
        return SigningKey::from_pkcs8_pem(&pem)
            .map_err(|e| InkboxError::Tunnel(format!("invalid PKCS#8 private key: {e}")));
    }

    // No key yet: ensure the 0o700 state dir exists, then generate + persist.
    ensure_private_state_dir(state_dir).map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    // Generate a fresh P-256 signing key from the OS CSPRNG (rand 0.8).
    let key = SigningKey::random(&mut rand::thread_rng());
    let pem = key_pem_string(&key)?;
    // 0o600, O_NOFOLLOW first-create — same hardening as the state file.
    write_private_file(&key_path, pem.as_bytes())
        .map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    Ok(key)
}

/// Serialize a private key as unencrypted PKCS#8 PEM bytes.
pub fn key_pem_bytes(key: &SigningKey) -> Result<Vec<u8>> {
    Ok(key_pem_string(key)?.into_bytes())
}

/// Encode the P-256 private key as an unencrypted PKCS#8 PEM string (LF).
fn key_pem_string(key: &SigningKey) -> Result<String> {
    key.to_pkcs8_pem(LineEnding::LF)
        .map(|z| z.to_string())
        .map_err(|e| InkboxError::Tunnel(format!("could not encode PKCS#8 PEM: {e}")))
}

/// Build a CSR (PEM) with subject `CN=<public_host>` and a non-critical
/// `subjectAltName` DNSName of `public_host`, signed with ECDSA/SHA-256.
///
/// Mirrors the Python `build_csr`: subject is a single CN RDN, the SAN
/// extension is added non-critical, and the request is signed with SHA-256
/// (the default digest for P-256 ECDSA in the RustCrypto stack).
///
/// # Arguments
/// * `key` - The P-256 signing key whose public key the CSR carries.
/// * `public_host` - The hostname placed in the CN and the SAN DNSName.
///
/// # Returns
/// The PKCS#10 CSR as a PEM string (`-----BEGIN CERTIFICATE REQUEST-----`).
pub fn build_csr(key: &SigningKey, public_host: &str) -> Result<String> {
    // Subject: single RDN, CN=<public_host>.
    let subject = Name::from_str(&format!("CN={public_host}"))
        .map_err(|e| InkboxError::Tunnel(format!("invalid CSR subject: {e}")))?;

    let mut builder = RequestBuilder::new(subject, key)
        .map_err(|e| InkboxError::Tunnel(format!("could not start CSR: {e}")))?;

    // subjectAltName = [DNSName(public_host)], non-critical (criticality is
    // determined by SubjectAltName's AsExtension impl, which is `false`).
    let dns = der::asn1::Ia5String::new(public_host)
        .map_err(|e| InkboxError::Tunnel(format!("invalid SAN DNS name: {e}")))?;
    let san = SubjectAltName(vec![GeneralName::DnsName(dns)]);
    builder
        .add_extension(&san)
        .map_err(|e| InkboxError::Tunnel(format!("could not add SAN extension: {e}")))?;

    // Sign over the CertificationRequestInfo with ECDSA/SHA-256, DER signature.
    let csr = builder
        .build::<DerSignature>()
        .map_err(|e| InkboxError::Tunnel(format!("could not sign CSR: {e}")))?;

    csr.to_pem(LineEnding::LF)
        .map_err(|e| InkboxError::Tunnel(format!("could not encode CSR PEM: {e}")))
}

/// Return the cached leaf cert's expiry as seconds since the Unix epoch, or
/// `None` if the cert file is missing or unparseable. Mirrors Python's
/// `cert_expiry` (reads `not_valid_after_utc`).
fn cert_expiry_secs(state_dir: &Path) -> Option<i64> {
    let cert_path = state_dir.join(CERT_FILE);
    if !cert_path.is_file() {
        return None;
    }
    let pem = std::fs::read(&cert_path).ok()?;
    // The chain file holds multiple PEM blocks (leaf + intermediates).
    // `from_pem` rejects trailing blocks, so parse the whole chain and take the
    // leaf (first cert) — matching the TS port's leaf-first behavior.
    let cert = Certificate::load_pem_chain(&pem).ok()?.into_iter().next()?;
    let secs = cert
        .tbs_certificate
        .validity
        .not_after
        .to_unix_duration()
        .as_secs();
    i64::try_from(secs).ok()
}

/// Decide whether the cached cert needs resigning.
///
/// Mirrors Python `cert_needs_sign`: resign when the cert is missing, its
/// expiry is unknown/unparseable, it is within the 14-day renewal threshold,
/// or the on-disk key no longer matches the cert's public key.
///
/// # Arguments
/// * `state_dir` - The tunnel state directory holding `cert_chain.pem`.
/// * `key` - The current P-256 signing key to compare against the cert.
///
/// # Returns
/// `true` if a (re)sign is needed, else `false`.
pub fn cert_needs_sign(state_dir: &Path, key: &SigningKey) -> bool {
    let cert_path = state_dir.join(CERT_FILE);
    let expiry = cert_expiry_secs(state_dir);

    // Missing file or unreadable expiry => resign.
    let expiry = match (cert_path.is_file(), expiry) {
        (true, Some(secs)) => secs,
        _ => return true,
    };

    // Within the renewal window => resign.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if expiry - now < CERT_RENEWAL_THRESHOLD_SECS {
        return true;
    }

    // In-window but the on-disk key may have been regenerated since signing.
    // Compare the cert's SPKI against the current key's SPKI; mismatch =>
    // resign. Any parse/encode failure is treated as "resign".
    match cert_spki_der(&cert_path) {
        Some(cert_spki) => {
            let key_spki = match key
                .verifying_key()
                .to_public_key_der()
                .map(|d| d.as_bytes().to_vec())
            {
                Ok(d) => d,
                Err(_) => return true,
            };
            cert_spki != key_spki
        }
        None => true,
    }
}

/// Read the leaf cert's SubjectPublicKeyInfo as DER bytes, or `None` on error.
fn cert_spki_der(cert_path: &Path) -> Option<Vec<u8>> {
    let pem = std::fs::read(cert_path).ok()?;
    // Parse the full chain and take the leaf; `from_pem` rejects trailing blocks.
    let cert = Certificate::load_pem_chain(&pem).ok()?.into_iter().next()?;
    let spki: &SubjectPublicKeyInfoOwned = &cert.tbs_certificate.subject_public_key_info;
    use der::Encode;
    spki.to_der().ok()
}

/// Persist the signed cert + chain (mode 0o600); return the bytes.
///
/// Matches the Python / TS layout: leaf cert first, then the chain, written to
/// `{state_dir}/cert_chain.pem`.
pub fn write_cert_chain(state_dir: &Path, cert_pem: &str, chain_pem: &str) -> Result<Vec<u8>> {
    let full_chain = format!("{cert_pem}{chain_pem}").into_bytes();
    let cert_path = state_dir.join(CERT_FILE);
    write_private_file(&cert_path, &full_chain).map_err(|e| InkboxError::Tunnel(e.to_string()))?;
    Ok(full_chain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use der::DecodePem; // CertReq::from_pem in the CSR test
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
        // Second call loads the persisted PEM and must yield the same key.
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
    fn build_csr_emits_parseable_pkcs10_with_cn() {
        let dir = unique_dir("csr");
        let k = load_or_create_keypair(&dir).unwrap();
        let host = "my-agent.inkboxwire.com";
        let pem = build_csr(&k, host).unwrap();
        assert!(pem.starts_with("-----BEGIN CERTIFICATE REQUEST-----"));

        // Parse it back as a PKCS#10 CertReq and assert subject CN == host.
        let csr = x509_cert::request::CertReq::from_pem(pem.as_bytes()).unwrap();
        let subject = csr.info.subject.to_string();
        // RdnSequence Display renders as "CN=<host>".
        assert!(
            subject.contains(&format!("CN={host}")),
            "unexpected subject: {subject}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cert_needs_sign_when_missing() {
        let dir = unique_dir("needsign");
        let k = load_or_create_keypair(&dir).unwrap();
        assert!(cert_needs_sign(&dir, &k));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
