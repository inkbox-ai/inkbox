//! Identity-scoped call operations: list, get, transcripts, place.

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::filters::DateRangeFilter;
use crate::http::HttpTransport;
use crate::phone::types::{CallOrigin, PhoneCall, PhoneCallWithRateLimit, PhoneTranscript};

pub struct CallsResource {
    http: Arc<HttpTransport>,
}

impl CallsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List calls, newest first.
    ///
    /// Identity-scoped API keys resolve their own identity and never see
    /// contact-rule-blocked rows regardless of `is_blocked` (filtered
    /// server-side). Admin/JWT callers must pass `agent_identity_id` (the
    /// server returns 422 otherwise).
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity to scope
    ///   to. `None` for agent-scoped keys; required under admin/JWT.
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    /// * `is_blocked` - Tri-state filter: `Some(true)` for only blocked,
    ///   `Some(false)` for only non-blocked, `None` for all.
    pub fn list(
        &self,
        agent_identity_id: Option<&str>,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<PhoneCall>> {
        // Delegate to the filtered variant with an empty (default) date range,
        // which sends no extra params — wire-identical to the original list.
        self.list_filtered(
            agent_identity_id,
            limit,
            offset,
            is_blocked,
            &DateRangeFilter::default(),
        )
    }

    /// List calls, newest first, additionally narrowed by a `created_at`
    /// [`DateRangeFilter`].
    ///
    /// Identical to [`CallsResource::list`] but also forwards the filter's
    /// `start_date` / `end_date` / `tz`. A default filter sends nothing extra,
    /// so this behaves exactly like `list`.
    ///
    /// # Arguments
    /// * `agent_identity_id` / `limit` / `offset` / `is_blocked` - See
    ///   [`CallsResource::list`].
    /// * `filter` - Optional `created_at` date-range bounds.
    pub fn list_filtered(
        &self,
        agent_identity_id: Option<&str>,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
        filter: &DateRangeFilter,
    ) -> Result<Vec<PhoneCall>> {
        // Always send limit + offset; scope by identity + filter only when set.
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        filter.apply(&mut params);
        let data = self.http.get("/calls", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a single call by ID.
    ///
    /// # Arguments
    /// * `call_id` - UUID (or string) of the call.
    pub fn get(&self, call_id: &str) -> Result<PhoneCall> {
        let data = self
            .http
            .get(&format!("/calls/{call_id}"), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List all transcript segments for a call, ordered by sequence number.
    ///
    /// # Arguments
    /// * `call_id` - UUID (or string) of the call.
    pub fn transcripts(&self, call_id: &str) -> Result<Vec<PhoneTranscript>> {
        let data = self.http.get(
            &format!("/calls/{call_id}/transcripts"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Place an outbound call.
    ///
    /// The server enforces the conditional requirements: `from_number` is
    /// required for `dedicated_number`, `agent_identity_id` for
    /// `shared_imessage_number`. Omissions surface as a server 422.
    ///
    /// # Arguments
    /// * `to_number` - E.164 number to call.
    /// * `origination` - Where the call originates (defaults to
    ///   [`CallOrigin::DedicatedNumber`]).
    /// * `from_number` - E.164 number to call from (dedicated origination).
    /// * `agent_identity_id` - UUID of the placing identity (shared origination).
    /// * `client_websocket_url` - WebSocket URL (wss://) for audio bridging.
    ///
    /// # Returns
    /// The created call record with current rate limit info.
    pub fn place(
        &self,
        to_number: &str,
        origination: CallOrigin,
        from_number: Option<&str>,
        agent_identity_id: Option<&str>,
        client_websocket_url: Option<&str>,
    ) -> Result<PhoneCallWithRateLimit> {
        // Always send origination; include the rest only when provided.
        let mut body = Map::new();
        body.insert("to_number".into(), to_number.into());
        body.insert("origination".into(), origination.as_str().into());
        if let Some(n) = from_number {
            body.insert("from_number".into(), n.into());
        }
        if let Some(id) = agent_identity_id {
            body.insert("agent_identity_id".into(), id.into());
        }
        if let Some(url) = client_websocket_url {
            body.insert("client_websocket_url".into(), url.into());
        }
        let data = self
            .http
            .post("/place-call", Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::error::{ApiErrorDetail, InkboxError};
    use crate::phone::types::CallOrigin;

    /// Client whose phone transport points at the mock server (phone resources
    /// ride the `/api/v1/phone` sub-base).
    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    /// A dedicated-origin `PhoneCall` response payload.
    fn call_json() -> serde_json::Value {
        json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "local_phone_number": "+15550001111",
            "remote_phone_number": "+15550002222",
            "direction": "outbound",
            "status": "completed",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:01+00:00",
            "is_blocked": false,
            "origin": "dedicated_number"
        })
    }

    /// A place-call response: flat call fields + `rate_limit` snapshot.
    fn placed_json(origin: &str, local: serde_json::Value) -> serde_json::Value {
        json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "local_phone_number": local,
            "remote_phone_number": "+15550002222",
            "direction": "outbound",
            "status": "initiated",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
            "is_blocked": false,
            "origin": origin,
            "rate_limit": {
                "calls_used": 1,
                "calls_remaining": 9,
                "calls_limit": 10,
                "minutes_used": 1.5,
                "minutes_remaining": 58.5,
                "minutes_limit": 60
            }
        })
    }

    #[test]
    fn list_sends_scope_and_filter_params_when_set() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls")
                .query_param("limit", "25")
                .query_param("offset", "5")
                .query_param("agent_identity_id", "33333333-3333-3333-3333-333333333333")
                .query_param("is_blocked", "true");
            then.status(200).json_body(json!([call_json()]));
        });
        let calls = client(&server)
            .calls()
            .list(
                Some("33333333-3333-3333-3333-333333333333"),
                25,
                5,
                Some(true),
            )
            .unwrap();
        mock.assert();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].remote_phone_number, "+15550002222");
    }

    #[test]
    fn list_filtered_sends_date_range_params_when_set() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls")
                .query_param("start_date", "2026-07-01")
                .query_param("end_date", "2026-07-06")
                .query_param("tz", "America/New_York");
            then.status(200).json_body(json!([]));
        });
        let filter = crate::DateRangeFilter {
            start_date: Some("2026-07-01".to_string()),
            end_date: Some("2026-07-06".to_string()),
            tz: Some("America/New_York".to_string()),
        };
        client(&server)
            .calls()
            .list_filtered(None, 50, 0, None, &filter)
            .unwrap();
        mock.assert();
    }

    #[test]
    fn list_omits_identity_and_blocked_params_when_none() {
        // Custom matcher: exactly limit + offset, nothing else on the wire.
        fn only_limit_and_offset(req: &HttpMockRequest) -> bool {
            let params = req.query_params.clone().unwrap_or_default();
            let mut keys: Vec<&str> = params.iter().map(|(k, _)| k.as_str()).collect();
            keys.sort_unstable();
            keys == ["limit", "offset"]
        }
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls")
                .matches(only_limit_and_offset);
            then.status(200).json_body(json!([]));
        });
        let calls = client(&server).calls().list(None, 50, 0, None).unwrap();
        mock.assert();
        assert!(calls.is_empty());
    }

    #[test]
    fn list_is_blocked_false_is_sent_as_false() {
        // Tri-state: Some(false) must serialize as is_blocked=false, not vanish.
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls")
                .query_param("is_blocked", "false");
            then.status(200).json_body(json!([]));
        });
        client(&server)
            .calls()
            .list(None, 50, 0, Some(false))
            .unwrap();
        mock.assert();
    }

    #[test]
    fn get_fetches_call_by_id() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls/22222222-2222-2222-2222-222222222222");
            then.status(200).json_body(call_json());
        });
        let call = client(&server)
            .calls()
            .get("22222222-2222-2222-2222-222222222222")
            .unwrap();
        mock.assert();
        assert_eq!(call.status, "completed");
        assert_eq!(call.local_phone_number.as_deref(), Some("+15550001111"));
    }

    #[test]
    fn transcripts_fetches_segments_for_call() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls/22222222-2222-2222-2222-222222222222/transcripts");
            then.status(200).json_body(json!([
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "call_id": "22222222-2222-2222-2222-222222222222",
                    "seq": 0,
                    "ts_ms": 0,
                    "party": "remote",
                    "text": "Hi",
                    "created_at": "2026-06-01T00:00:02+00:00"
                },
                {
                    "id": "66666666-6666-6666-6666-666666666666",
                    "call_id": "22222222-2222-2222-2222-222222222222",
                    "seq": 1,
                    "ts_ms": 900,
                    "party": "agent",
                    "text": "Hello!",
                    "created_at": "2026-06-01T00:00:03+00:00"
                }
            ]));
        });
        let segments = client(&server)
            .calls()
            .transcripts("22222222-2222-2222-2222-222222222222")
            .unwrap();
        mock.assert();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].seq, 0);
        assert_eq!(segments[1].text, "Hello!");
    }

    #[test]
    fn place_dedicated_sends_from_number() {
        let server = MockServer::start();
        // Exact json_body match: guarantees no stray keys in the request body.
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "dedicated_number",
                    "from_number": "+15550001111"
                }));
            then.status(200)
                .json_body(placed_json("dedicated_number", json!("+15550001111")));
        });
        let placed = client(&server)
            .calls()
            .place(
                "+15550002222",
                CallOrigin::DedicatedNumber,
                Some("+15550001111"),
                None,
                None,
            )
            .unwrap();
        mock.assert();
        assert_eq!(placed.call.origin, CallOrigin::DedicatedNumber);
        assert_eq!(
            placed.call.local_phone_number.as_deref(),
            Some("+15550001111")
        );
        let rl = placed.rate_limit.expect("rate_limit present");
        assert_eq!(rl.calls_remaining, 9);
        assert_eq!(rl.minutes_remaining, 58.5);
    }

    #[test]
    fn place_shared_sends_identity_and_no_from_number_key() {
        let server = MockServer::start();
        // Exact body: agent_identity_id in, from_number key never serialized.
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "shared_imessage_number",
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333"
                }));
            then.status(200).json_body(placed_json(
                "shared_imessage_number",
                serde_json::Value::Null,
            ));
        });
        let placed = client(&server)
            .calls()
            .place(
                "+15550002222",
                CallOrigin::SharedImessageNumber,
                None,
                Some("33333333-3333-3333-3333-333333333333"),
                None,
            )
            .unwrap();
        mock.assert();
        assert_eq!(placed.call.origin, CallOrigin::SharedImessageNumber);
        assert_eq!(placed.call.local_phone_number, None);
    }

    #[test]
    fn place_sends_client_websocket_url_when_set() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "dedicated_number",
                    "from_number": "+15550001111",
                    "client_websocket_url": "wss://example.com/audio"
                }));
            then.status(200)
                .json_body(placed_json("dedicated_number", json!("+15550001111")));
        });
        client(&server)
            .calls()
            .place(
                "+15550002222",
                CallOrigin::DedicatedNumber,
                Some("+15550001111"),
                None,
                Some("wss://example.com/audio"),
            )
            .unwrap();
        mock.assert();
    }

    #[test]
    fn place_409_no_shared_connection_maps_to_api_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/api/v1/phone/place-call");
            then.status(409).json_body(json!({
                "detail": {
                    "error": "no_shared_connection",
                    "detail": "No active shared iMessage connection for this identity"
                }
            }));
        });
        let err = client(&server)
            .calls()
            .place(
                "+15550002222",
                CallOrigin::SharedImessageNumber,
                None,
                Some("33333333-3333-3333-3333-333333333333"),
                None,
            )
            .unwrap_err();
        match err {
            InkboxError::Api {
                status_code,
                detail,
            } => {
                assert_eq!(status_code, 409);
                // Structured detail keeps the machine-readable error field.
                let obj = detail.as_object().expect("structured detail");
                assert_eq!(obj["error"], "no_shared_connection");
            }
            other => panic!("expected InkboxError::Api, got {other:?}"),
        }
    }

    #[test]
    fn place_422_maps_to_api_error_with_message_detail() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/api/v1/phone/place-call");
            then.status(422).json_body(json!({
                "detail": "from_number is required for dedicated_number origination"
            }));
        });
        let err = client(&server)
            .calls()
            .place(
                "+15550002222",
                CallOrigin::DedicatedNumber,
                None,
                None,
                None,
            )
            .unwrap_err();
        match err {
            InkboxError::Api {
                status_code,
                detail,
            } => {
                assert_eq!(status_code, 422);
                match detail {
                    ApiErrorDetail::Message(m) => assert!(m.contains("from_number")),
                    other => panic!("expected message detail, got {other:?}"),
                }
            }
            other => panic!("expected InkboxError::Api, got {other:?}"),
        }
    }
}
