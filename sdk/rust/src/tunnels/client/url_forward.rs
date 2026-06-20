//! URL-forward HTTP proxy helpers: path-traversal validation, the
//! loopback-only SSRF guard, and prefix path joining.
//!
//! The actual upstream forwarding (`forward_envelope_to_url`) needs an async
//! HTTP client and lives in the runtime; the pure validation + joining logic
//! lives here so it stays unit-testable.
//!
//! Ported from `inkbox/tunnels/client/_url_forward.py`.

use super::envelope::Envelope;
use super::protocol::is_hop_by_hop_request;

/// `forward_to` points outside the allowlist and `allow_remote_forwarding`
/// is false (or the scheme/host is invalid).
#[derive(Debug)]
pub struct ForwardTargetRefused(pub String);

impl std::fmt::Display for ForwardTargetRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for ForwardTargetRefused {}

const LOOPBACK_LITERALS: &[&str] = &["localhost", "127.0.0.1", "::1"];

/// A minimal split of a URL into scheme / host / port / path / query, enough
/// for the forwarding helpers. Mirrors the subset of `urllib.parse.urlsplit`
/// the Python module relies on.
#[derive(Debug, Clone)]
pub struct UrlParts {
    pub scheme: String,
    pub netloc: String,
    pub host: String,
    pub path: String,
    pub query: String,
}

/// Split a URL into its component parts. Best-effort, ASCII-oriented; matches
/// the fields the Python code reads off `urlsplit` (`scheme`, `netloc`,
/// `hostname`, `path`).
pub fn url_split(url: &str) -> UrlParts {
    // scheme://
    let (scheme, rest) = match url.find("://") {
        Some(i) => (url[..i].to_string(), &url[i + 3..]),
        None => (String::new(), url),
    };
    // netloc ends at the first '/', '?' or '#'.
    let netloc_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let netloc = rest[..netloc_end].to_string();
    let after = &rest[netloc_end..];
    let (path, query) = match after.find('?') {
        Some(i) => {
            let q = &after[i + 1..];
            let q = q.split('#').next().unwrap_or("");
            (after[..i].to_string(), q.to_string())
        }
        None => {
            let p = after.split('#').next().unwrap_or("");
            (p.to_string(), String::new())
        }
    };
    // hostname: strip userinfo + port. Handle bracketed IPv6 ([::1]:8080).
    let host = parse_hostname(&netloc);
    UrlParts {
        scheme,
        netloc,
        host,
        path,
        query,
    }
}

/// Extract the hostname from a netloc, dropping any `user@` and `:port` and
/// unwrapping a bracketed IPv6 literal. Lowercasing is left to the caller.
fn parse_hostname(netloc: &str) -> String {
    // Drop userinfo.
    let hostport = netloc.rsplit('@').next().unwrap_or(netloc);
    if let Some(stripped) = hostport.strip_prefix('[') {
        // IPv6: [host]:port — take up to the closing bracket.
        if let Some(end) = stripped.find(']') {
            return stripped[..end].to_string();
        }
        return stripped.to_string();
    }
    // Otherwise host:port — strip the trailing :port if present.
    match hostport.rfind(':') {
        Some(i) => hostport[..i].to_string(),
        None => hostport.to_string(),
    }
}

/// Validate `forward_to` against the loopback-only allowlist.
///
/// Default behaviour refuses any host that isn't a literal loopback form
/// (`localhost`, IPv4 in `127.0.0.0/8`, or IPv6 `::1`). Hostnames that would
/// resolve to loopback are also refused — the SDK doesn't invoke the system
/// resolver, so DNS rebinding can't slip a sensitive target past the check.
///
/// Pass `allow_remote_forwarding = true` to skip validation entirely.
pub fn validate_forward_target(
    forward_to: &str,
    allow_remote_forwarding: bool,
) -> Result<(), ForwardTargetRefused> {
    if allow_remote_forwarding {
        return Ok(());
    }
    let parsed = url_split(forward_to);
    if parsed.scheme != "http" && parsed.scheme != "https" {
        return Err(ForwardTargetRefused(format!(
            "forward_to scheme must be http or https; got {:?}",
            parsed.scheme
        )));
    }
    let host = parsed.host;
    if host.is_empty() {
        return Err(ForwardTargetRefused(format!(
            "forward_to has no host: {forward_to:?}"
        )));
    }
    let host_lower = host.to_ascii_lowercase();
    if LOOPBACK_LITERALS.contains(&host_lower.as_str()) {
        return Ok(());
    }
    // Try to parse as a literal IP; a hostname (rebinding-prone) errors and
    // falls through to the final refusal.
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() => Ok(()),
        Ok(_) => Err(ForwardTargetRefused(format!(
            "forward_to address {host:?} is not loopback; pass \
             allow_remote_forwarding=True to bypass (review the SSRF tradeoff first)"
        ))),
        Err(_) => Err(ForwardTargetRefused(format!(
            "forward_to host {host:?} is not a literal loopback address; \
             pass allow_remote_forwarding=True to bypass (review the SSRF \
             tradeoff first)"
        ))),
    }
}

/// Reject path-traversal evasion attempts.
///
/// Returns `None` on success, or an `inkbox-reason` string on rejection.
///
/// Algorithm (mirrors Python):
/// 1. Pre-decode reject — raw `%2f`/`%2F`/`%5c`/`%5C` are encoded `/`/`\`,
///    evasion-only.
/// 2. Iterative percent-decode, max 2 passes; still changing after pass 2 is
///    triple+ encoding => reject.
/// 3. After decoding stabilizes, split on `/` and reject any segment equal to
///    `.` or `..`, containing a raw backslash, or containing a control byte
///    (`< 0x20` or `0x7f`).
///
/// The original path is forwarded verbatim — decoding is for validation only.
pub fn validate_envelope_path(path: &str) -> Option<String> {
    let raw_path = path.split('?').next().unwrap_or("");
    let lowered = raw_path.to_ascii_lowercase();
    for forbidden in ["%2f", "%5c"] {
        if lowered.contains(forbidden) {
            return Some("invalid-path".to_string());
        }
    }
    // Iterative percent-decode, max 2 passes.
    let decoded: String = {
        let pass1 = percent_decode(raw_path);
        if pass1 != raw_path {
            let pass2 = percent_decode(&pass1);
            if pass2 != pass1 {
                return Some("invalid-path".to_string());
            }
            pass2
        } else {
            pass1
        }
    };
    for segment in decoded.split('/') {
        if segment == "." || segment == ".." {
            return Some("invalid-path".to_string());
        }
        if segment.contains('\\') {
            return Some("invalid-path".to_string());
        }
        for ch in segment.chars() {
            let o = ch as u32;
            if o < 0x20 || o == 0x7F {
                return Some("invalid-path".to_string());
            }
        }
    }
    None
}

/// Percent-decode a string (`%XX` -> byte), passing through invalid escapes
/// unchanged and rendering decoded bytes as Latin-1 chars so a control byte
/// stays detectable. Mirrors the relevant behaviour of `urllib.parse.unquote`
/// for the byte-range the validator inspects.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1]);
            let lo = hex_val(bytes[i + 2]);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    // Interpret each byte as a Unicode scalar (Latin-1) so control bytes and
    // separators remain detectable in the segment scan above.
    out.iter().map(|&b| b as char).collect()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Prefix-join the envelope's path onto `forward_to`'s base path.
pub fn join_forward_path(forward_to: &str, envelope_path: &str) -> String {
    let parsed = url_split(forward_to);
    let mut base_path = parsed.path.clone();
    if base_path.ends_with('/') {
        base_path.pop();
    }
    let (mut raw_path, query) = match envelope_path.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (envelope_path.to_string(), None),
    };
    if !raw_path.starts_with('/') {
        raw_path = format!("/{raw_path}");
    }
    let full_path = if base_path.is_empty() {
        raw_path
    } else {
        format!("{base_path}{raw_path}")
    };
    // urlunsplit((scheme, netloc, path, query, "")).
    let mut out = String::new();
    if !parsed.scheme.is_empty() {
        out.push_str(&parsed.scheme);
        out.push_str("://");
    }
    out.push_str(&parsed.netloc);
    out.push_str(&full_path);
    if let Some(q) = query {
        out.push('?');
        out.push_str(&q);
    }
    out
}

/// Build the headers we send to `forward_to`.
///
/// Hop-by-hop headers and inbound `X-Forwarded-For` / `Forwarded` headers are
/// stripped here (defense in depth — the server side also strips inbound
/// forwarded-for headers from third-party traffic so only this SDK's view of
/// the source IP reaches your app). The SDK then injects `Host`,
/// `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For`, `Forwarded` so
/// the user's app sees a consistent forwarded-headers view.
///
/// Mirrors Python `build_forward_headers`.
///
/// # Arguments
/// * `envelope` - The inbound envelope whose forwarded headers we relay.
/// * `public_host` - The tunnel's public hostname, injected as `X-Forwarded-Host`.
/// * `target_host` - The upstream authority (`netloc`), injected as `Host`.
///
/// # Returns
/// The ordered `(name, value)` header pairs to send upstream.
pub fn build_forward_headers(
    envelope: &Envelope,
    public_host: &str,
    target_host: &str,
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    // Rewrite Host to the upstream authority and inject the forwarding view.
    out.push(("Host".to_string(), target_host.to_string()));
    out.push(("X-Forwarded-Host".to_string(), public_host.to_string()));
    out.push(("X-Forwarded-Proto".to_string(), "https".to_string()));
    if let Some(ip) = &envelope.forwarded_for_ip {
        if !ip.is_empty() {
            out.push(("X-Forwarded-For".to_string(), ip.clone()));
            out.push(("Forwarded".to_string(), format!("for={ip}")));
        }
    }
    // Headers we've already set (lowercased) — skip any inbound dupes.
    const SEEN_SPECIAL: &[&str] = &[
        "host",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-for",
        "forwarded",
    ];
    for (k, v) in &envelope.forwarded_headers {
        let kl = k.to_ascii_lowercase();
        // Strip hop-by-hop request headers and our injected specials.
        if is_hop_by_hop_request(&kl) {
            continue;
        }
        if SEEN_SPECIAL.contains(&kl.as_str()) {
            continue;
        }
        out.push((k.clone(), v.clone()));
    }
    out
}

/// Result of forwarding one envelope to the local upstream URL.
pub struct ForwardResult {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Optional `inkbox-reason` to attach to the reply (e.g. on a 502).
    pub inkbox_reason: Option<String>,
}

/// Forward `envelope` to the local `forward_to` base URL and return the
/// upstream response. Mirrors Python `forward_envelope_to_url`.
///
/// The caller is expected to have already:
///   - Validated `forward_to` via [`validate_forward_target`].
///   - Validated the envelope's path via [`validate_envelope_path`].
///   - Materialized the inbound body (resolved any `inkbox-body-uri`).
///
/// # Arguments
/// * `envelope` - The inbound request to forward.
/// * `forward_to` - The local upstream base URL (e.g. `http://localhost:8080`).
/// * `public_host` - The tunnel's public hostname for `X-Forwarded-Host`.
/// * `client` - The shared async `reqwest::Client` used for the upstream call.
/// * `max_outbound_body_bytes` - Cap on the buffered upstream response body.
///
/// # Returns
/// A [`ForwardResult`] carrying the upstream status/headers/body, or a `502`
/// with an `inkbox_reason` on transport error or oversized response.
pub async fn forward_envelope_to_url(
    envelope: &Envelope,
    forward_to: &str,
    public_host: &str,
    client: &reqwest::Client,
    max_outbound_body_bytes: usize,
) -> ForwardResult {
    let parsed = url_split(forward_to);
    // Host header = the upstream authority (includes any :port), per Python.
    let target_host = parsed.netloc.clone();
    let target_url = join_forward_path(forward_to, &envelope.path);
    let headers = build_forward_headers(envelope, public_host, &target_host);

    // Parse the method; an unknown verb is a non-recoverable client-side
    // problem, so surface it as an upstream-error 502 rather than panicking.
    let method = match reqwest::Method::from_bytes(envelope.method.as_bytes()) {
        Ok(m) => m,
        Err(_) => return upstream_error(),
    };

    // Translate the (name, value) pairs into a reqwest HeaderMap, skipping any
    // header that won't form a valid HTTP header (defense in depth).
    let mut header_map = reqwest::header::HeaderMap::new();
    for (k, v) in &headers {
        let name = match reqwest::header::HeaderName::from_bytes(k.as_bytes()) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let value = match reqwest::header::HeaderValue::from_str(v) {
            Ok(val) => val,
            Err(_) => continue,
        };
        header_map.append(name, value);
    }

    // Fire the request; a transport/connection error maps to upstream-error.
    let resp = match client
        .request(method, &target_url)
        .headers(header_map)
        .body(envelope.body.clone())
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return upstream_error(),
    };

    let status = resp.status().as_u16();
    // Response header names are yielded lowercased, matching Python.
    let resp_headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_ascii_lowercase(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();

    // Stream the body so we can bail early once the cap is exceeded without
    // buffering an oversized response into memory first.
    let mut buf: Vec<u8> = Vec::new();
    let mut resp = resp;
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len() + chunk.len() > max_outbound_body_bytes {
                    return response_too_large();
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return upstream_error(),
        }
    }

    ForwardResult {
        status,
        headers: resp_headers,
        body: buf,
        inkbox_reason: None,
    }
}

/// The fixed 502 shape returned on a transport/connection/stream error,
/// matching Python's `upstream-error` reason.
fn upstream_error() -> ForwardResult {
    ForwardResult {
        status: 502,
        headers: vec![("content-type".to_string(), "text/plain".to_string())],
        body: b"upstream error".to_vec(),
        inkbox_reason: Some("upstream-error".to_string()),
    }
}

/// The fixed 502 shape returned when the upstream body exceeds the cap,
/// matching Python's `response-too-large` reason.
fn response_too_large() -> ForwardResult {
    ForwardResult {
        status: 502,
        headers: vec![("content-type".to_string(), "text/plain".to_string())],
        body: b"response too large".to_vec(),
        inkbox_reason: Some("response-too-large".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- validate_forward_target (mirrors test_tunnels_data_plane.py) ----

    #[test]
    fn accepts_loopback() {
        for t in [
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://127.0.0.5:9000",
            "http://[::1]:8080",
        ] {
            validate_forward_target(t, false).unwrap_or_else(|e| panic!("{t}: {e}"));
        }
    }

    #[test]
    fn refuses_non_loopback() {
        for t in [
            "http://example.com",
            "http://10.0.0.5",
            "http://192.168.1.1",
            "http://internal.example.com",
            "http://1.2.3.4",
        ] {
            assert!(validate_forward_target(t, false).is_err(), "{t}");
        }
    }

    #[test]
    fn allow_remote_bypass() {
        validate_forward_target("http://example.com", true).unwrap();
    }

    #[test]
    fn rejects_bad_scheme() {
        assert!(validate_forward_target("ftp://localhost", false).is_err());
    }

    // --- validate_envelope_path ------------------------------------------

    #[test]
    fn rejects_traversal() {
        for p in [
            "/foo/../bar",
            "/foo/./bar",
            "/foo/%2e%2e/bar",
            "/foo/%2E%2E/bar",
            "/foo/%252e%252e/bar",
            "/foo/%2f/bar",
            "/foo/%5cbar",
            "/foo\\..\\bar",
            "/static\\secret",
            "/\\evil",
        ] {
            assert_eq!(
                validate_envelope_path(p).as_deref(),
                Some("invalid-path"),
                "{p}"
            );
        }
    }

    #[test]
    fn accepts_legitimate_paths() {
        for p in [
            "/webhook",
            "/api/v1/users",
            "/path/with%20space",
            "/with-query?x=1&y=2",
        ] {
            assert_eq!(validate_envelope_path(p), None, "{p}");
        }
    }

    // --- join_forward_path -----------------------------------------------

    #[test]
    fn join_simple() {
        assert_eq!(
            join_forward_path("http://localhost:8080", "/webhook?x=1"),
            "http://localhost:8080/webhook?x=1"
        );
    }

    #[test]
    fn join_with_base() {
        assert_eq!(
            join_forward_path("http://localhost:8080/base", "/webhook?x=1"),
            "http://localhost:8080/base/webhook?x=1"
        );
    }

    #[test]
    fn join_strips_trailing_slash_on_base() {
        assert_eq!(
            join_forward_path("http://localhost:8080/base/", "/webhook"),
            "http://localhost:8080/base/webhook"
        );
    }

    // --- build_forward_headers (mirrors the Python header-injection) -----

    fn envelope_with(
        forwarded_headers: &[(&str, &str)],
        forwarded_for_ip: Option<&str>,
    ) -> Envelope {
        Envelope {
            request_id: "req-1".to_string(),
            method: "POST".to_string(),
            path: "/webhook".to_string(),
            route_kind: "webhook".to_string(),
            ws_id: None,
            forwarded_headers: forwarded_headers
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            body: Vec::new(),
            body_uri: None,
            forwarded_for_ip: forwarded_for_ip.map(str::to_string),
            tcp_id: None,
            sni_host: None,
            extra_meta: std::collections::BTreeMap::new(),
        }
    }

    #[test]
    fn forward_headers_inject_host_and_forwarding() {
        let env = envelope_with(&[("content-type", "application/json")], Some("1.2.3.4"));
        let out = build_forward_headers(&env, "tun.example.com", "localhost:8080");
        assert_eq!(
            out,
            vec![
                ("Host".to_string(), "localhost:8080".to_string()),
                (
                    "X-Forwarded-Host".to_string(),
                    "tun.example.com".to_string()
                ),
                ("X-Forwarded-Proto".to_string(), "https".to_string()),
                ("X-Forwarded-For".to_string(), "1.2.3.4".to_string()),
                ("Forwarded".to_string(), "for=1.2.3.4".to_string()),
                ("content-type".to_string(), "application/json".to_string()),
            ]
        );
    }

    #[test]
    fn forward_headers_omit_forwarded_for_when_absent() {
        let env = envelope_with(&[("accept", "*/*")], None);
        let out = build_forward_headers(&env, "tun.example.com", "127.0.0.1:9000");
        assert_eq!(
            out,
            vec![
                ("Host".to_string(), "127.0.0.1:9000".to_string()),
                (
                    "X-Forwarded-Host".to_string(),
                    "tun.example.com".to_string()
                ),
                ("X-Forwarded-Proto".to_string(), "https".to_string()),
                ("accept".to_string(), "*/*".to_string()),
            ]
        );
    }

    #[test]
    fn forward_headers_strip_hop_by_hop() {
        // `host`, `connection`, `transfer-encoding`, `upgrade` are hop-by-hop.
        let env = envelope_with(
            &[
                ("Connection", "keep-alive"),
                ("Transfer-Encoding", "chunked"),
                ("Upgrade", "websocket"),
                ("Host", "evil.example"),
                ("X-Real-Custom", "kept"),
            ],
            None,
        );
        let out = build_forward_headers(&env, "tun.example.com", "localhost:8080");
        assert_eq!(
            out,
            vec![
                ("Host".to_string(), "localhost:8080".to_string()),
                (
                    "X-Forwarded-Host".to_string(),
                    "tun.example.com".to_string()
                ),
                ("X-Forwarded-Proto".to_string(), "https".to_string()),
                ("X-Real-Custom".to_string(), "kept".to_string()),
            ]
        );
    }

    #[test]
    fn forward_headers_drop_inbound_forwarding_dupes() {
        // Inbound x-forwarded-* / forwarded are dropped in favor of ours.
        let env = envelope_with(
            &[
                ("X-Forwarded-For", "9.9.9.9"),
                ("X-Forwarded-Host", "spoof.example"),
                ("X-Forwarded-Proto", "http"),
                ("Forwarded", "for=9.9.9.9"),
                ("X-Trace", "abc"),
            ],
            Some("1.2.3.4"),
        );
        let out = build_forward_headers(&env, "tun.example.com", "localhost:8080");
        assert_eq!(
            out,
            vec![
                ("Host".to_string(), "localhost:8080".to_string()),
                (
                    "X-Forwarded-Host".to_string(),
                    "tun.example.com".to_string()
                ),
                ("X-Forwarded-Proto".to_string(), "https".to_string()),
                ("X-Forwarded-For".to_string(), "1.2.3.4".to_string()),
                ("Forwarded".to_string(), "for=1.2.3.4".to_string()),
                ("X-Trace".to_string(), "abc".to_string()),
            ]
        );
    }

    #[test]
    fn target_host_is_netloc_with_port() {
        // The Host header uses the full netloc (authority) including the port.
        assert_eq!(
            url_split("http://localhost:8080/base").netloc,
            "localhost:8080"
        );
        assert_eq!(url_split("http://127.0.0.1:9000").netloc, "127.0.0.1:9000");
    }
}
