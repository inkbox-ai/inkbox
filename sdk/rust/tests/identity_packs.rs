use httpmock::prelude::*;
use inkbox::billing::{IdentityPackPaymentMode, IdentityPackStatus};
use inkbox::{Inkbox, InkboxError};
use serde_json::{json, Value};
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/identity_packs.json")).unwrap()
}

#[test]
fn identity_pack_pages_quotes_and_payment_actions_preserve_wire_values() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-admin-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let fixture = fixture();
    let agreement_id =
        Uuid::parse_str(fixture["mutation"]["agreement_id"].as_str().unwrap()).unwrap();
    let page = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/billing/identity-packs")
            .header("X-API-Key", "synthetic-admin-key")
            .query_param("cursor", agreement_id.to_string())
            .query_param("limit", "1");
        then.status(200).json_body(fixture["list"].clone());
    });
    let result = client
        .billing()
        .identity_packs(Some(agreement_id), Some(1))
        .unwrap();
    assert_eq!(serde_json::to_value(&result).unwrap(), fixture["list"]);
    assert_eq!(result.offer.unwrap().monthly_amount, "100.00");
    assert_eq!(result.next_cursor, Some(agreement_id));
    assert_eq!(result.agreements[0].paid_through, None);
    assert_eq!(
        result.agreements[0].status,
        IdentityPackStatus::RequiresPayment
    );
    assert_eq!(result.capacity.total, 10);
    page.assert();

    let mut last_page = fixture["list"].clone();
    last_page["offer"] = Value::Null;
    last_page["agreements"] = json!([]);
    last_page["next_cursor"] = Value::Null;
    last_page["eligible"] = json!(false);
    last_page["eligibility_reason"] = fixture["paid_plan_required"].clone();
    let last = server.mock(|when, then| {
        when.method(GET).path("/api/v1/billing/identity-packs");
        then.status(200).json_body(last_page);
    });
    let result = client.billing().identity_packs(None, None).unwrap();
    assert!(result.offer.is_none());
    assert!(result.agreements.is_empty());
    assert!(result.next_cursor.is_none());
    assert!(!result.eligible);
    last.assert();

    let quote = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/identity-packs/quote")
            .json_body(json!({}));
        then.status(200).json_body(fixture["quote"].clone());
    });
    let result = client.billing().quote_identity_pack().unwrap();
    assert_eq!(serde_json::to_value(&result).unwrap(), fixture["quote"]);
    assert_eq!(result.monthly_amount, "100.00");
    assert_eq!(result.amount_due_cents, 5000);
    assert_eq!(result.renewal_at, Some(2001209600));
    assert_eq!(result.payment_mode, IdentityPackPaymentMode::Quantity);
    quote.assert();

    let request_key = Uuid::new_v4();
    let purchase = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/identity-packs")
            .header("X-API-Key", "synthetic-admin-key")
            .json_body(json!({
                "quote": result.quote, "request_key": request_key
            }));
        then.status(202).json_body(fixture["mutation"].clone());
    });
    for _ in 0..2 {
        let response = client
            .billing()
            .purchase_identity_pack(&result.quote, request_key)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&response).unwrap(),
            fixture["mutation"]
        );
        assert_eq!(response.agreement_id, agreement_id);
        assert_eq!(response.status, IdentityPackStatus::RequiresPayment);
        assert_eq!(
            response.payment_url.as_deref(),
            Some("https://example.com/payment/action")
        );
    }
    purchase.assert_hits(2);
}

#[test]
fn identity_pack_retry_after_unavailable_response_keeps_request() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-admin-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let request_key = Uuid::new_v4();
    let expected = json!({"quote": "accepted", "request_key": request_key});
    let mut unavailable = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/identity-packs")
            .json_body(expected.clone());
        then.status(504)
            .json_body(json!({"detail": "Response unavailable"}));
    });
    let error = client
        .billing()
        .purchase_identity_pack("accepted", request_key)
        .unwrap_err();
    assert!(matches!(
        error,
        InkboxError::Api {
            status_code: 504,
            ..
        }
    ));
    unavailable.assert_hits(1);
    unavailable.delete();
    let recovered = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/identity-packs")
            .json_body(expected);
        then.status(202).json_body(fixture()["mutation"].clone());
    });
    assert_eq!(
        client
            .billing()
            .purchase_identity_pack("accepted", request_key)
            .unwrap()
            .status,
        IdentityPackStatus::RequiresPayment
    );
    recovered.assert();
}

#[test]
fn identity_pack_action_keys_survive_opposite_actions_and_retries() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-admin-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let agreement_id = Uuid::new_v4();
    let cancel_key = Uuid::new_v4();
    let resume_key = Uuid::new_v4();
    let cancel = server.mock(|when, then| {
        when.method(POST)
            .path(format!(
                "/api/v1/billing/identity-packs/{agreement_id}/cancel"
            ))
            .json_body(json!({"request_key": cancel_key}));
        then.status(202).json_body(
            json!({"agreement_id": agreement_id, "status": "canceling", "payment_url": null}),
        );
    });
    let resume = server.mock(|when, then| {
        when.method(POST)
            .path(format!(
                "/api/v1/billing/identity-packs/{agreement_id}/resume"
            ))
            .json_body(json!({"request_key": resume_key}));
        then.status(202).json_body(
            json!({"agreement_id": agreement_id, "status": "active", "payment_url": null}),
        );
    });
    for _ in 0..2 {
        let result = client
            .billing()
            .cancel_identity_pack(agreement_id, cancel_key)
            .unwrap();
        assert_eq!(result.status, IdentityPackStatus::Canceling);
        assert_eq!(result.payment_url, None);
        assert_eq!(
            client
                .billing()
                .resume_identity_pack(agreement_id, resume_key)
                .unwrap()
                .status,
            IdentityPackStatus::Active
        );
    }
    cancel.assert_hits(2);
    resume.assert_hits(2);
}

#[test]
fn identity_pack_auth_errors_and_capacity_conflicts_keep_status_and_detail() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let agreement_id = Uuid::new_v4();
    for (status, expected) in [
        (401, json!("Invalid API key")),
        (403, json!("Organization-admin API key required")),
        (409, fixture()["conflict"].clone()),
    ] {
        let mut error_response = server.mock(|when, then| {
            when.method(POST).path(format!(
                "/api/v1/billing/identity-packs/{agreement_id}/cancel"
            ));
            then.status(status).json_body(json!({"detail": expected}));
        });
        match client
            .billing()
            .cancel_identity_pack(agreement_id, Uuid::new_v4())
            .unwrap_err()
        {
            InkboxError::Api {
                status_code,
                detail,
                ..
            } => {
                assert_eq!(status_code, status);
                if let Some(text) = expected.as_str() {
                    assert_eq!(detail.to_string(), text);
                } else {
                    assert_eq!(detail.as_object(), Some(&expected));
                }
            }
            other => panic!("Unexpected error: {other}"),
        }
        error_response.assert();
        error_response.delete();
    }
}

#[test]
fn identity_pack_paid_plan_requirement_preserves_history_and_errors() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-admin-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let fixture = fixture();
    let mut retained = fixture["list"].clone();
    retained["eligible"] = json!(false);
    retained["eligibility_reason"] = fixture["paid_plan_required"].clone();
    let list = server.mock(|when, then| {
        when.method(GET).path("/api/v1/billing/identity-packs");
        then.status(200).json_body(retained.clone());
    });
    let page = client.billing().identity_packs(None, None).unwrap();
    assert_eq!(serde_json::to_value(page).unwrap(), retained);
    list.assert_hits(1);

    let agreement_id = Uuid::new_v4();
    for action in ["quote", "purchase", "resume"] {
        let path = match action {
            "quote" => "/api/v1/billing/identity-packs/quote".to_owned(),
            "purchase" => "/api/v1/billing/identity-packs".to_owned(),
            _ => format!("/api/v1/billing/identity-packs/{agreement_id}/resume"),
        };
        let rejected = server.mock(|when, then| {
            when.method(POST).path(path);
            then.status(409)
                .json_body(json!({"detail": fixture["paid_plan_required"]}));
        });
        let result = match action {
            "quote" => client.billing().quote_identity_pack().map(|_| ()),
            "purchase" => client
                .billing()
                .purchase_identity_pack("accepted", Uuid::new_v4())
                .map(|_| ()),
            _ => client
                .billing()
                .resume_identity_pack(agreement_id, Uuid::new_v4())
                .map(|_| ()),
        };
        match result.unwrap_err() {
            InkboxError::Api {
                status_code,
                detail,
                ..
            } => {
                assert_eq!(status_code, 409);
                assert_eq!(
                    detail.to_string(),
                    fixture["paid_plan_required"].as_str().unwrap()
                );
            }
            other => panic!("Unexpected error: {other}"),
        }
        rejected.assert_hits(1);
    }
}
