use crate::{APIResponse, Inkbox, InkboxError, ResponseMetadata};
use httpmock::prelude::*;
use serde_json::{json, Value};
use std::sync::{Arc, Barrier, Mutex};

fn notice(code: &str) -> Value {
    json!({"code":code,"level":"future_level","message":"Receiving and sending settings differ.","extra":"ignored"})
}
fn header(code: &str) -> String {
    json!([notice(code)]).to_string()
}
fn client(server: &MockServer) -> Arc<Inkbox> {
    Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap()
}

#[test]
fn optional_metadata_normalizes_and_retains_valid_unknown_entries() {
    for value in [
        json!({"data":null}),
        json!({"data":null,"notices":null}),
        json!({"data":null,"notices":[]}),
        json!({"data":null,"notices":[{"code":2}]}),
        json!({"data":null,"notices":"invalid"}),
    ] {
        let parsed: APIResponse<()> = serde_json::from_value(value).unwrap();
        assert!(parsed.notices.is_none());
        assert_eq!(serde_json::to_value(parsed).unwrap(), json!({"data":null}));
    }
    let value: ResponseMetadata = serde_json::from_value(
        json!({"notices":[notice("unknown"), {"message":"broken"}, notice("unknown")]}),
    )
    .unwrap();
    assert_eq!(value.notices.unwrap().len(), 1);
}

#[test]
fn transport_handles_all_payload_shapes_before_status_mapping() {
    use crate::http::{HttpTransport, NO_QUERY};
    let server = MockServer::start();
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observer = observed.clone();
    let mut http = HttpTransport::new(
        "test-key",
        server.base_url(),
        5.0,
        Arc::new(crate::cookies::CookieJar::new()),
        "test-client",
    )
    .unwrap();
    http.response_context.observer = Some(Arc::new(move |meta| {
        observer.lock().unwrap().push(meta.clone())
    }));
    for (path, body) in [
        ("/object", json!({"value":1})),
        ("/array", json!([1, 2])),
        ("/scalar", json!(42)),
    ] {
        let request = server.mock(|when, then| {
            when.method(GET).path(path);
            then.status(200)
                .header("Inkbox-Notices", header(path))
                .json_body(body.clone());
        });
        assert_eq!(http.get(path, NO_QUERY).unwrap(), body);
        request.assert();
    }
    let binary = server.mock(|when, then| {
        when.method(GET).path("/binary");
        then.status(200)
            .header("Inkbox-Notices", header("binary"))
            .header("Content-Type", "application/octet-stream")
            .header("Content-Disposition", "attachment; filename=example.bin")
            .body([0, 255, 128]);
    });
    let bytes = http
        .get_binary("/binary", "application/octet-stream", NO_QUERY)
        .unwrap();
    assert_eq!(bytes.bytes, [0, 255, 128]);
    assert_eq!(bytes.filename.as_deref(), Some("example.bin"));
    let empty = server.mock(|when, then| {
        when.method(DELETE).path("/empty");
        then.status(204).header("Inkbox-Notices", header("empty"));
    });
    http.delete("/empty").unwrap();
    let failed = server.mock(|when, then| { when.method(POST).path("/failed"); then.status(409).header("Inkbox-Notices", header("failed")).json_body(json!({"detail":{"existing_rule_id":"11111111-1111-4111-8111-111111111111"},"agent_support":"Support information"})); });
    let err = http
        .post("/failed", Some(&json!({})), NO_QUERY)
        .unwrap_err();
    assert!(matches!(&err, InkboxError::DuplicateContactRule { .. }));
    assert_eq!(err.agent_support(), Some("Support information"));
    let broken = server.mock(|when, then| {
        when.method(GET).path("/broken");
        then.status(200)
            .header("Inkbox-Notices", header("broken"))
            .body("{invalid");
    });
    assert!(matches!(
        http.get("/broken", NO_QUERY),
        Err(InkboxError::Decode(_))
    ));
    assert_eq!(observed.lock().unwrap().len(), 7);
    for request in [binary, empty, failed, broken] {
        request.assert();
    }
}

#[test]
fn header_precedence_and_declared_body_fallback_do_not_scan_user_data() {
    let server = MockServer::start();
    let client = client(&server);
    for (handle, header_value, expected) in [
        ("header", Some(header("header")), Some("header")),
        ("body", None, Some("body")),
        ("malformed", Some("{broken".into()), Some("body")),
        (
            "invalid_entries",
            Some("[{\"code\":3}]".into()),
            Some("body"),
        ),
        ("empty", Some("[]".into()), None),
        ("null", Some("null".into()), None),
    ] {
        let request = server.mock(|when, mut then| {
            when.method(GET)
                .path(format!("/api/v1/identities/{handle}"));
            if let Some(header) = header_value {
                then = then.header("Inkbox-Notices", header);
            }
            let mut body = crate::directional_tests::identity();
            body["notices"] = json!([notice("body")]);
            then.status(200).json_body(body);
        });
        let result = client
            .with_response_metadata(|scoped| scoped.identities().get(handle))
            .unwrap();
        assert_eq!(
            result.notices.as_ref().map(|v| v[0].code.as_str()),
            expected
        );
        request.assert();
    }
    let user = server.mock(|when, then| {
        when.method(GET).path("/api/v1/contacts/contact");
        then.status(200).json_body(json!({"id":"11111111-1111-4111-8111-111111111111","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z", "notices":[notice("user")]}));
    });
    assert!(client
        .with_response_metadata(|c| c.contacts().get("contact"))
        .unwrap()
        .notices
        .is_none());
    user.assert();
}

#[test]
fn avatar_body_metadata_is_put_only_and_keeps_header_precedence() {
    use crate::http::{HttpTransport, NO_QUERY};

    for (method, suffix, header_value, expected) in [
        (PUT, "avatar", None, Some("body")),
        (PUT, "avatar/", None, Some("body")),
        (PUT, "avatar", Some(header("header")), Some("header")),
        (PUT, "avatar/", Some("[]".into()), None),
        (PUT, "avatar", Some("{broken".into()), Some("body")),
        (GET, "avatar", None, None),
        (GET, "avatar/", None, None),
        (GET, "avatar", Some(header("header")), Some("header")),
        (PUT, "other", None, None),
        (PUT, "avatar/other", None, None),
    ] {
        let server = MockServer::start();
        let is_get = matches!(method, GET);
        let path = format!("/api/v1/identities/agent/{suffix}");
        let mut body = crate::directional_tests::identity();
        body["notices"] = json!([notice("body")]);
        let bytes = serde_json::to_vec(&body).unwrap();
        let request = server.mock(|when, mut then| {
            when.method(method).path(&path);
            if let Some(value) = header_value {
                then = then.header("Inkbox-Notices", value);
            }
            then.status(200)
                .header(
                    "Content-Type",
                    if is_get {
                        "image/png"
                    } else {
                        "application/json"
                    },
                )
                .body(bytes.clone());
        });
        let observed = Arc::new(Mutex::new(Vec::new()));
        let sink = observed.clone();
        let mut http = HttpTransport::new(
            "test-key",
            server.base_url(),
            5.0,
            Arc::new(crate::cookies::CookieJar::new()),
            "test-client",
        )
        .unwrap();
        http.response_context.observer = Some(Arc::new(move |metadata| {
            sink.lock().unwrap().push(metadata.clone());
        }));
        if is_get {
            assert_eq!(
                http.get_binary(&path, "image/png", NO_QUERY).unwrap().bytes,
                bytes
            );
        } else {
            assert_eq!(http.put(&path, &json!({})).unwrap(), body);
        }
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), 1);
        assert_eq!(
            observed[0].notices.as_ref().map(|v| v[0].code.as_str()),
            expected
        );
        request.assert();
    }
}

#[test]
fn scoped_collection_deduplicates_pages_and_isolates_nested_and_concurrent_calls() {
    let server = MockServer::start();
    let client = client(&server);
    for code in ["outer", "inner", "left", "right", "parent"] {
        server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/notes")
                .query_param("q", code)
                .header("X-API-Key", "test-key");
            then.status(200)
                .header("Inkbox-Notices", header(code))
                .json_body(json!([]));
        });
    }
    let outer = client
        .with_response_metadata(|scoped| {
            scoped.notes().list(Some("outer"), None, None, None, None)?;
            let inner = scoped.with_response_metadata(|nested| {
                nested.notes().list(Some("inner"), None, None, None, None)
            })?;
            assert_eq!(inner.notices.unwrap()[0].code, "inner");
            client
                .notes()
                .list(Some("parent"), None, None, None, None)?;
            scoped
                .notes()
                .list(Some("outer"), None, None, Some(1), None)
        })
        .unwrap();
    assert_eq!(
        outer
            .notices
            .unwrap()
            .iter()
            .map(|n| n.code.as_str())
            .collect::<Vec<_>>(),
        ["outer"]
    );
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = ["left", "right"]
        .into_iter()
        .map(|code| {
            let client = client.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                client
                    .with_response_metadata(|scoped| {
                        barrier.wait();
                        scoped.notes().list(Some(code), None, None, None, None)
                    })
                    .unwrap()
                    .notices
                    .unwrap()[0]
                    .code
                    .clone()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>(),
        ["left", "right"]
    );
}

#[test]
fn observers_see_errors_and_panics_never_retry_writes() {
    let server = MockServer::start();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let client = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .response_observer(move |metadata| {
            sink.lock().unwrap().push(metadata.clone());
            panic!("observer failure");
        })
        .build()
        .unwrap();
    let success = server.mock(|when, then| {
        when.method(DELETE).path("/api/v1/identities/agent");
        then.status(204).header("Inkbox-Notices", header("success"));
    });
    let failure = server.mock(|when, then| {
        when.method(GET).path("/api/v1/identities/agent");
        then.status(403)
            .header("Inkbox-Notices", header("failure"))
            .json_body(json!({"detail":"Denied", "agent_support":"Support information"}));
    });
    let response = client
        .with_response_metadata(|scoped| scoped.identities().delete("agent"))
        .unwrap();
    assert_eq!(serde_json::to_value(response).unwrap()["data"], Value::Null);
    let error = client
        .with_response_metadata(|scoped| scoped.identities().get("agent"))
        .unwrap_err();
    assert!(matches!(
        &error,
        InkboxError::Api {
            status_code: 403,
            ..
        }
    ));
    assert_eq!(error.agent_support(), Some("Support information"));
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[1].notices.as_ref().unwrap()[0].code, "failure");
    success.assert();
    failure.assert();
}

#[test]
fn scoped_client_preserves_cookies_and_identity_helpers_without_setup_requests() {
    let server = MockServer::start();
    let first = server.mock(|when, then| {
        when.method(GET).path("/api/v1/identities/agent");
        then.status(200)
            .header("Set-Cookie", "session=example; Path=/")
            .json_body(crate::directional_tests::identity());
    });
    let rule = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/identities/agent/mail-contact-rules/rule")
            .header("Cookie", "session=example");
        then.status(204).header("Inkbox-Notices", header("rule"));
    });
    let client = client(&server);
    let empty = client.with_response_metadata(|_| Ok(42)).unwrap();
    assert_eq!(empty.data, 42);
    assert!(empty.notices.is_none());
    first.assert_hits(0);
    let identity = client.get_identity("agent").unwrap();
    let result = identity
        .with_response_metadata(|scoped| scoped.delete_mail_contact_rule("rule"))
        .unwrap();
    assert_eq!(result.notices.unwrap()[0].code, "rule");
    first.assert();
    rule.assert();
}

#[test]
fn every_subtransport_and_nested_resource_observes_completed_responses() {
    let server = MockServer::start();
    let client = client(&server);
    let response = server.mock(|_, then| {
        then.status(403)
            .header("Inkbox-Notices", header("denied"))
            .json_body(json!({"detail":"Denied"}));
    });
    type Operation = fn(&Inkbox) -> crate::Result<()>;
    let operations: &[Operation] = &[
        |c| c.whoami().map(|_| ()),
        |c| c.mailboxes().get("x@example.com").map(|_| ()),
        |c| c.phone_numbers().get("number").map(|_| ()),
        |c| c.imessage_contact_rules().get("agent", "rule").map(|_| ()),
        |c| c.identities().get("agent").map(|_| ()),
        |c| c.vault().info().map(|_| ()),
        |c| c.domains().list(None).map(|_| ()),
        |c| c.contacts().access().get("agent", "contact").map(|_| ()),
        |c| c.contacts().vcards().export_vcard("contact").map(|_| ()),
        |c| c.signing_keys().get_status("agent").map(|_| ()),
        |c| c.a2a().public_directory(&Default::default()).map(|_| ()),
    ];
    for operation in operations {
        let result = client
            .with_response_metadata(|scoped| {
                assert!(matches!(
                    operation(scoped),
                    Err(InkboxError::Api {
                        status_code: 403,
                        ..
                    })
                ));
                Ok(())
            })
            .unwrap();
        assert_eq!(result.notices.unwrap()[0].code, "denied");
    }
    response.assert_hits(operations.len());
}
