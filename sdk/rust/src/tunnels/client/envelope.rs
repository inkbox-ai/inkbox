//! Tunnel envelope parsing. Pure / synchronous; no I/O. The
//! `inkbox-body-uri` materialization step lives in the runtime so this
//! module stays trivially unit-testable.
//!
//! Ported from `inkbox/tunnels/client/_envelope.py` line for line.

use std::collections::BTreeMap;

use super::protocol::{
    is_hop_by_hop_response, INKBOX_FORWARDED_HEADER_PREFIX, INKBOX_NAMESPACE_PREFIX, META_BODY_URI,
    META_FORWARDED_FOR, META_METHOD, META_PATH, META_REQUEST_ID, META_ROUTE_KIND, META_SNI_HOST,
    META_TCP_ID, META_WS_ID,
};

/// One inbound third-party request, parsed from tunnel-server headers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    pub request_id: String,
    pub method: String,
    pub path: String,
    /// `"webhook"` | `"ws-upgrade"` | `"tcp-stream"`.
    pub route_kind: String,
    pub ws_id: Option<String>,
    pub forwarded_headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub body_uri: Option<String>,
    pub forwarded_for_ip: Option<String>,
    pub tcp_id: Option<String>,
    pub sni_host: Option<String>,
    pub extra_meta: BTreeMap<String, String>,
}

/// Parse a `/_system/intake` response into an [`Envelope`].
///
/// Returns `None` if the headers are missing the required
/// `inkbox-request-id` field.
///
/// The returned envelope's `body` may be empty when the server has offloaded
/// the body to an out-of-band fetch URL — in that case `body_uri` is set and
/// the runtime materializes it before dispatch.
///
/// # Arguments
/// * `headers` - The intake response headers (name, value) pairs.
/// * `body` - The (possibly empty) inline body bytes.
///
/// # Returns
/// The parsed [`Envelope`], or `None` when `inkbox-request-id` is absent.
pub fn parse_envelope(headers: &[(String, String)], body: Vec<u8>) -> Option<Envelope> {
    let mut request_id = String::new();
    let mut method = String::from("GET");
    let mut path = String::from("/");
    let mut route_kind = String::from("webhook");
    let mut ws_id: Option<String> = None;
    let mut tcp_id: Option<String> = None;
    let mut sni_host: Option<String> = None;
    let mut body_uri: Option<String> = None;
    let mut forwarded_for_ip: Option<String> = None;
    let mut forwarded: Vec<(String, String)> = Vec::new();
    let mut extra: BTreeMap<String, String> = BTreeMap::new();

    for (k, v) in headers {
        // Header names arrive ASCII; lowercase to match the Python
        // `.lower()` comparison.
        let kl = k.to_ascii_lowercase();
        if kl == META_REQUEST_ID {
            request_id = v.clone();
        } else if kl == META_METHOD {
            method = v.clone();
        } else if kl == META_PATH {
            path = v.clone();
        } else if kl == META_ROUTE_KIND {
            route_kind = v.clone();
        } else if kl == META_WS_ID {
            ws_id = Some(v.clone());
        } else if kl == META_TCP_ID {
            tcp_id = Some(v.clone());
        } else if kl == META_SNI_HOST {
            sni_host = Some(v.clone());
        } else if kl == META_BODY_URI {
            body_uri = Some(v.clone());
        } else if kl == META_FORWARDED_FOR {
            forwarded_for_ip = Some(v.clone());
            extra.insert(kl.clone(), v.clone());
        } else if let Some(rest) = kl.strip_prefix(INKBOX_FORWARDED_HEADER_PREFIX) {
            // A forwarded third-party header: strip the `inkbox-h-` prefix.
            forwarded.push((rest.to_string(), v.clone()));
        } else if kl.starts_with(INKBOX_NAMESPACE_PREFIX) {
            extra.insert(kl, v.clone());
        }
    }

    if request_id.is_empty() {
        return None;
    }
    Some(Envelope {
        request_id,
        method,
        path,
        route_kind,
        ws_id,
        forwarded_headers: forwarded,
        body,
        body_uri,
        forwarded_for_ip,
        tcp_id,
        sni_host,
        extra_meta: extra,
    })
}

/// Drop hop-by-hop headers from an upstream response before forwarding.
pub fn filter_response_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(k, _)| !is_hop_by_hop_response(&k.to_ascii_lowercase()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // Mirrors test_parse_envelope_basic.
    #[test]
    fn parse_envelope_basic() {
        let headers = h(&[
            ("inkbox-request-id", "req-1"),
            ("inkbox-method", "POST"),
            ("inkbox-path", "/webhook?x=1"),
            ("inkbox-route-kind", "webhook"),
            ("inkbox-h-content-type", "application/json"),
            ("inkbox-forwarded-for", "1.2.3.4"),
        ]);
        let env = parse_envelope(&headers, b"{\"hello\":1}".to_vec()).unwrap();
        assert_eq!(env.request_id, "req-1");
        assert_eq!(env.method, "POST");
        assert_eq!(env.path, "/webhook?x=1");
        assert_eq!(env.route_kind, "webhook");
        assert_eq!(
            env.forwarded_headers,
            vec![("content-type".to_string(), "application/json".to_string())]
        );
        assert_eq!(env.forwarded_for_ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(env.body, b"{\"hello\":1}");
        assert_eq!(env.body_uri, None);
    }

    // Mirrors test_parse_envelope_with_body_uri.
    #[test]
    fn parse_envelope_with_body_uri() {
        let headers = h(&[
            ("inkbox-request-id", "req-2"),
            ("inkbox-method", "POST"),
            ("inkbox-path", "/upload"),
            ("inkbox-route-kind", "webhook"),
            ("inkbox-body-uri", "https://body.example/bigblob?token=xyz"),
        ]);
        let env = parse_envelope(&headers, Vec::new()).unwrap();
        assert_eq!(
            env.body_uri.as_deref(),
            Some("https://body.example/bigblob?token=xyz")
        );
        assert!(env.body.is_empty());
    }

    // Mirrors test_parse_envelope_missing_request_id_returns_none.
    #[test]
    fn parse_envelope_missing_request_id_returns_none() {
        let env = parse_envelope(&h(&[("inkbox-method", "GET")]), Vec::new());
        assert!(env.is_none());
    }

    #[test]
    fn filter_response_headers_drops_hop_by_hop() {
        let headers = h(&[
            ("Content-Type", "text/plain"),
            ("Connection", "keep-alive"),
            ("Transfer-Encoding", "chunked"),
            ("X-Custom", "ok"),
        ]);
        let out = filter_response_headers(&headers);
        assert_eq!(
            out,
            h(&[("Content-Type", "text/plain"), ("X-Custom", "ok")])
        );
    }
}
