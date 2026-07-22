//! Blocking HTTP transport (internal). Shared by all resource modules.
//!
//! A faithful port of `inkbox/_http.py`'s `HttpTransport`: one transport per
//! API sub-base, a shared [`CookieJar`], `X-API-Key` + `Accept` + `User-Agent`
//! defaults, and the structured `_raise_for_status` error mapping. Built on
//! `reqwest::blocking` so the public SDK surface stays synchronous like the
//! Python and TypeScript SDKs.

use std::sync::Arc;
use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder, Response};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::cookies::CookieJar;
use crate::error::{ApiErrorDetail, InkboxError, Result};

const DEFAULT_TIMEOUT_SECS: f64 = 30.0;

/// A cleaned query string: pairs whose value was `None` are simply never
/// pushed by the caller, mirroring `_http.py`'s `{k: v for ... if v is not None}`.
pub type Query<'a> = &'a [(&'a str, String)];

/// Per-request HTTP headers.
pub type Headers<'a> = &'a [(&'a str, &'a str)];

/// Empty query helper for paths that take no parameters.
pub const NO_QUERY: Query<'static> = &[];

/// Empty per-request header helper.
pub const NO_HEADERS: Headers<'static> = &[];

/// Validate an idempotency key before building its HTTP header.
pub(crate) fn validate_idempotency_key(key: &str) -> Result<()> {
    let length = key.chars().count();
    if !(1..=255).contains(&length) {
        return Err(InkboxError::InvalidArgument(
            "idempotency_key must contain 1 to 255 characters".into(),
        ));
    }
    reqwest::header::HeaderValue::from_str(key).map_err(|_| {
        InkboxError::InvalidArgument("idempotency_key is not a valid HTTP header value".into())
    })?;
    Ok(())
}

#[derive(Debug)]
pub struct HttpTransport {
    client: Client,
    base_url: String,
    cookie_jar: Arc<CookieJar>,
}

impl HttpTransport {
    pub fn new(
        api_key: &str,
        base_url: impl Into<String>,
        timeout_secs: f64,
        cookie_jar: Arc<CookieJar>,
        user_agent: &str,
    ) -> Result<Self> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "X-API-Key",
            reqwest::header::HeaderValue::from_str(api_key)
                .map_err(|_| InkboxError::InvalidArgument("invalid api_key bytes".into()))?,
        );
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json"),
        );
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_str(user_agent)
                .map_err(|_| InkboxError::InvalidArgument("invalid user_agent bytes".into()))?,
        );
        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs_f64(timeout_secs))
            .build()?;
        Ok(Self {
            client,
            base_url: base_url.into(),
            cookie_jar,
        })
    }

    fn url(&self, path: &str) -> String {
        // `path` is a server-relative segment like "/messages" or "messages".
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    pub fn get(&self, path: &str, params: Query) -> Result<Value> {
        let resp = self.send(
            self.client.get(self.url(path)).query(params),
            &self.url(path),
        )?;
        raise_for_status(resp)?.json_value()
    }

    pub fn post<B: Serialize>(&self, path: &str, body: Option<&B>, params: Query) -> Result<Value> {
        self.post_with_headers(path, body, params, NO_HEADERS)
    }

    /// `POST` with caller-supplied per-request headers.
    pub fn post_with_headers<B: Serialize>(
        &self,
        path: &str,
        body: Option<&B>,
        params: Query,
        headers: Headers,
    ) -> Result<Value> {
        let mut rb = self.client.post(self.url(path)).query(params);
        for (name, value) in headers {
            rb = rb.header(*name, *value);
        }
        if let Some(b) = body {
            rb = rb.json(b);
        }
        let resp = raise_for_status(self.send(rb, &self.url(path))?)?;
        resp.json_or_null()
    }

    /// `POST` with a per-request timeout override (the Python SDK's `timeout=`
    /// kwarg). Used by long-running control-plane calls like tunnel CSR
    /// signing, which the server performs synchronously and can take minutes.
    pub fn post_with_timeout<B: Serialize>(
        &self,
        path: &str,
        body: Option<&B>,
        params: Query,
        timeout_secs: f64,
    ) -> Result<Value> {
        let mut rb = self
            .client
            .post(self.url(path))
            .query(params)
            .timeout(Duration::from_secs_f64(timeout_secs));
        if let Some(b) = body {
            rb = rb.json(b);
        }
        let resp = raise_for_status(self.send(rb, &self.url(path))?)?;
        resp.json_or_null()
    }

    pub fn put<B: Serialize>(&self, path: &str, body: &B) -> Result<Value> {
        let rb = self.client.put(self.url(path)).json(body);
        raise_for_status(self.send(rb, &self.url(path))?)?.json_value()
    }

    pub fn patch<B: Serialize>(&self, path: &str, body: &B) -> Result<Value> {
        self.patch_with_headers(path, body, NO_HEADERS)
    }

    /// `PATCH` with caller-supplied per-request headers.
    pub fn patch_with_headers<B: Serialize>(
        &self,
        path: &str,
        body: &B,
        headers: Headers,
    ) -> Result<Value> {
        let mut rb = self.client.patch(self.url(path)).json(body);
        for (name, value) in headers {
            rb = rb.header(*name, *value);
        }
        raise_for_status(self.send(rb, &self.url(path))?)?.json_value()
    }

    pub fn delete(&self, path: &str) -> Result<()> {
        self.delete_with_headers(path, NO_HEADERS)
    }

    /// `DELETE` with caller-supplied per-request headers.
    pub fn delete_with_headers(&self, path: &str, headers: Headers) -> Result<()> {
        let rb = self.client.delete(self.url(path));
        let rb = headers
            .iter()
            .fold(rb, |request, (name, value)| request.header(*name, *value));
        raise_for_status(self.send(rb, &self.url(path))?)?;
        Ok(())
    }

    /// `DELETE` that returns a parsed JSON body (e.g. tunnels respond with a
    /// representation of the deleted resource rather than 204).
    pub fn delete_with_response(&self, path: &str) -> Result<Value> {
        self.delete_with_response_and_headers(path, NO_HEADERS)
    }

    /// `DELETE` with caller-supplied headers that returns a parsed JSON body.
    pub fn delete_with_response_and_headers(&self, path: &str, headers: Headers) -> Result<Value> {
        let rb = self.client.delete(self.url(path));
        let rb = headers
            .iter()
            .fold(rb, |request, (name, value)| request.header(*name, *value));
        raise_for_status(self.send(rb, &self.url(path))?)?.json_or_null()
    }

    /// POST one file as `multipart/form-data`. Used for media uploads.
    pub fn post_multipart(
        &self,
        path: &str,
        field_name: &str,
        filename: &str,
        content: Vec<u8>,
        content_type: &str,
    ) -> Result<Value> {
        let part = reqwest::blocking::multipart::Part::bytes(content)
            .file_name(filename.to_string())
            .mime_str(content_type)
            .map_err(InkboxError::Transport)?;
        let form = reqwest::blocking::multipart::Form::new().part(field_name.to_string(), part);
        let rb = self.client.post(self.url(path)).multipart(form);
        raise_for_status(self.send(rb, &self.url(path))?)?.json_or_null()
    }

    /// POST arbitrary bytes with a caller-supplied `Content-Type` (e.g. vCard
    /// imports). The response is still decoded as JSON.
    pub fn post_bytes(
        &self,
        path: &str,
        content: Vec<u8>,
        content_type: &str,
        accept: &str,
    ) -> Result<Value> {
        self.post_bytes_with_headers(path, content, content_type, accept, NO_HEADERS)
    }

    /// POST arbitrary bytes with caller-supplied per-request headers.
    pub fn post_bytes_with_headers(
        &self,
        path: &str,
        content: Vec<u8>,
        content_type: &str,
        accept: &str,
        headers: Headers,
    ) -> Result<Value> {
        let rb = self
            .client
            .post(self.url(path))
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .header(reqwest::header::ACCEPT, accept)
            .body(content);
        let rb = headers
            .iter()
            .fold(rb, |request, (name, value)| request.header(*name, *value));
        raise_for_status(self.send(rb, &self.url(path))?)?.json_or_null()
    }

    /// GET a non-JSON response and return the raw body (e.g. vCard export).
    pub fn get_bytes(&self, path: &str, accept: &str, params: Query) -> Result<Vec<u8>> {
        let rb = self
            .client
            .get(self.url(path))
            .header(reqwest::header::ACCEPT, accept)
            .query(params);
        let resp = raise_for_status(self.send(rb, &self.url(path))?)?;
        Ok(resp.0.bytes()?.to_vec())
    }

    /// Apply the shared cookie jar (request `Cookie` header in, `Set-Cookie`
    /// out), then execute. Mirrors `HttpTransport._send`.
    fn send(&self, rb: RequestBuilder, url: &str) -> Result<RawResponse> {
        let rb = match self.cookie_jar.header_for_url(url) {
            Some(cookie) => rb.header(reqwest::header::COOKIE, cookie),
            None => rb,
        };
        let resp = rb.send()?;
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
            .collect();
        self.cookie_jar
            .store_from_headers(url, set_cookies.iter().map(|s| s.as_str()));
        Ok(RawResponse(resp))
    }

    /// Per-request timeout override (the SDK's `timeout=` kwargs). Reserved for
    /// resources that need a longer deadline than the client default.
    #[allow(dead_code)]
    pub(crate) fn with_timeout(rb: RequestBuilder, timeout_secs: Option<f64>) -> RequestBuilder {
        match timeout_secs {
            Some(t) => rb.timeout(Duration::from_secs_f64(t)),
            None => rb,
        }
    }
}

/// Thin newtype so we can attach status/body helpers without leaking reqwest.
pub struct RawResponse(Response);

impl RawResponse {
    fn status(&self) -> u16 {
        self.0.status().as_u16()
    }

    fn json_value(self) -> Result<Value> {
        let text = self.0.text()?;
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    /// JSON body, or `Null` for 204 / empty bodies (mirrors the `if 204`
    /// guards on POST/DELETE in `_http.py`).
    fn json_or_null(self) -> Result<Value> {
        if self.status() == 204 {
            return Ok(Value::Null);
        }
        self.json_value()
    }
}

/// Port of `_raise_for_status`: map 4xx/5xx into the structured error variants.
fn raise_for_status(resp: RawResponse) -> Result<RawResponse> {
    let status = resp.status();
    if status < 400 {
        return Ok(resp);
    }

    let retry_after_header = resp
        .0
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let body = resp.0.text().unwrap_or_default();
    // `detail` is the `detail` field if the body is a JSON object, else the
    // raw text (matching `resp.json().get("detail", resp.text)`).
    let parsed: Option<Value> = serde_json::from_str(&body).ok();
    let raw_detail: Value = match &parsed {
        Some(Value::Object(map)) => map
            .get("detail")
            .cloned()
            .unwrap_or(Value::String(body.clone())),
        Some(other) => other.clone(),
        None => Value::String(body.clone()),
    };

    if status == 409 {
        if let Value::Object(map) = &raw_detail {
            if let Some(existing) = map.get("existing_rule_id") {
                let id = existing
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .unwrap_or_default();
                return Err(InkboxError::DuplicateContactRule {
                    status_code: status,
                    existing_rule_id: id,
                    detail: Box::new(raw_detail),
                });
            }
            if map.get("error").and_then(|e| e.as_str()) == Some("redundant_grant") {
                return Err(InkboxError::RedundantContactAccessGrant {
                    status_code: status,
                    error: "redundant_grant".to_string(),
                    detail_message: map
                        .get("detail")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string(),
                    detail: Box::new(raw_detail),
                });
            }
            if map.get("error").and_then(|e| e.as_str()) == Some("idempotency_key_reused") {
                return Err(InkboxError::IdempotencyKeyReused {
                    status_code: status,
                    message: map
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .into(),
                    detail: Box::new(raw_detail),
                });
            }
        }
    }

    if status == 402 {
        if let Value::Object(map) = &raw_detail {
            // Older servers send a plain-string detail here; those fall through
            // to the generic `Api` variant below.
            if map.get("error").and_then(|e| e.as_str()) == Some("storage_limit_exceeded") {
                return Err(InkboxError::StorageLimitExceeded {
                    status_code: status,
                    message: map
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .to_string(),
                    upgrade_url: map
                        .get("upgrade_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                    limit_bytes: map.get("limit_bytes").and_then(Value::as_u64),
                    detail: Box::new(raw_detail),
                });
            }
            if map.get("error").and_then(|e| e.as_str())
                == Some("dedicated_imessage_number_quota_exceeded")
            {
                return Err(InkboxError::DedicatedIMessageNumberQuotaExceeded {
                    status_code: status,
                    message: map
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .into(),
                    number_type: map
                        .get("number_type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .into(),
                    limit: map.get("limit").and_then(Value::as_i64).unwrap_or(0),
                    current: map.get("current").and_then(Value::as_i64).unwrap_or(0),
                    upgrade_url: map
                        .get("upgrade_url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .into(),
                    contact_email: map
                        .get("contact_email")
                        .and_then(|e| e.as_str())
                        .unwrap_or("")
                        .into(),
                    detail: Box::new(raw_detail),
                });
            }
        }
    }

    if status == 503 {
        if let Value::Object(map) = &raw_detail {
            if map.get("error").and_then(|e| e.as_str())
                == Some("dedicated_imessage_number_inventory_pending")
            {
                let detail_retry_after = map
                    .get("retry_after_seconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                return Err(InkboxError::DedicatedIMessageNumberInventoryPending {
                    status_code: status,
                    message: map
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .into(),
                    number_type: map
                        .get("number_type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .into(),
                    retry_after_seconds: retry_after_header.unwrap_or(detail_retry_after),
                    retry_after_header,
                    detail: Box::new(raw_detail),
                });
            }
        }
    }

    if status == 403 {
        if let Value::Object(map) = &raw_detail {
            if map.get("error").and_then(|e| e.as_str()) == Some("recipient_blocked") {
                let matched = map
                    .get("matched_rule_id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok());
                return Err(InkboxError::RecipientBlocked {
                    status_code: status,
                    matched_rule_id: matched,
                    address: map
                        .get("address")
                        .and_then(|a| a.as_str())
                        .unwrap_or("")
                        .to_string(),
                    reason: map
                        .get("reason")
                        .and_then(|r| r.as_str())
                        .unwrap_or("")
                        .to_string(),
                    detail: Box::new(raw_detail),
                });
            }
        }
    }

    let detail = match raw_detail {
        Value::String(s) => ApiErrorDetail::Message(s),
        other => ApiErrorDetail::Structured(other),
    };
    Err(InkboxError::Api {
        status_code: status,
        detail,
    })
}

/// Default request timeout, exposed so the client builder and `_http.py`
/// parity stay in one place.
pub const fn default_timeout() -> f64 {
    DEFAULT_TIMEOUT_SECS
}
