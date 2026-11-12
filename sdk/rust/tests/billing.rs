use httpmock::prelude::*;
use inkbox::Inkbox;
use serde_json::json;
use uuid::Uuid;

#[test]
fn billing_keeps_decimal_rates_and_purchase_identity() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let pricing = server.mock(|when, then| {
        when.method(GET).path("/api/v1/billing/pricing");
        then.status(200).json_body(json!({"prices": [{
            "code": "call_seconds_outbound", "name": "Outbound calls", "kind": "usage",
            "unit": "second", "currency": "usd", "published_amount": "0.0005",
            "amount": null, "pricing_state": "unknown"
        }]}));
    });
    let rates = client.billing().pricing().unwrap();
    assert_eq!(rates.prices[0].published_amount, "0.0005");
    assert_eq!(rates.prices[0].amount, None);
    pricing.assert();

    let request_key = Uuid::new_v4();
    let purchase = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/calling-countries")
            .json_body(
                json!({"country_code":"FR", "quote":"signed-example", "request_key":request_key}),
            );
        then.status(202).json_body(
            json!({"countries":[], "agreements":[], "included_country_codes":["US","CA"]}),
        );
    });
    for _ in 0..2 {
        client
            .billing()
            .purchase_country("FR", "signed-example", request_key)
            .unwrap();
    }
    purchase.assert_hits(2);
}

#[test]
fn multiple_countries_share_one_purchase_request() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let quote = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/calling-countries/quote")
            .json_body(json!({"country_codes":["FR","JP"]}));
        then.status(200)
            .json_body(json!({"quote":"accepted", "expires_at":2000000000,
            "monthly_amount":"75", "country_amount_cents":3750, "invoice_total_cents":3750,
            "amount_due_cents":3750, "currency":"usd", "renewal_at":null}));
    });
    assert_eq!(
        client
            .billing()
            .quote_countries(&["FR", "JP"])
            .unwrap()
            .amount_due_cents,
        3750
    );
    quote.assert();
    let request_key = Uuid::new_v4();
    let purchase = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/billing/calling-countries")
            .json_body(
                json!({"country_codes":["FR","JP"], "quote":"accepted", "request_key":request_key}),
            );
        then.status(202).json_body(
            json!({"countries":[], "agreements":[], "included_country_codes":["US","CA"]}),
        );
    });
    for _ in 0..2 {
        client
            .billing()
            .purchase_countries(&["FR", "JP"], "accepted", request_key)
            .unwrap();
    }
    purchase.assert_hits(2);
}

#[test]
fn line_bundle_purchase_has_stable_request_identity() {
    use inkbox::billing::BundleCode;
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let key = Uuid::new_v4();
    let purchase = server.mock(|when, then| {
        when.method(POST).path("/api/v1/billing/line-bundles")
            .json_body(json!({"code":"voip_line_bundle", "quote":"accepted", "request_key":key}));
        then.status(202).json_body(json!({"offers":[], "agreements":[], "voice_seconds_remaining":900,"messages_remaining":150}));
    });
    for _ in 0..2 {
        let result = client
            .billing()
            .purchase_line_bundle(BundleCode::VoipLineBundle, "accepted", key)
            .unwrap();
        assert_eq!(result.messages_remaining, 150);
    }
    purchase.assert_hits(2);
}

#[test]
fn usage_alert_explicit_disable_and_delete() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::new_v4();
    let payload = json!({"id":id,"metric":"identities","threshold":90,"enabled":false,"mailbox_id":null,"is_default":false});
    let save = server.mock(|when, then| {
        when.method(PUT)
            .path(format!("/api/v1/billing/usage-alerts/{id}"))
            .json_body(
                json!({"metric":"identities","threshold":90,"enabled":false,"mailbox_id":null}),
            );
        then.status(200).json_body(payload.clone());
    });
    let input = inkbox::billing::UsageAlertInput {
        metric: "identities".into(),
        threshold: 90,
        enabled: false,
        mailbox_id: None,
    };
    assert!(
        !client
            .billing()
            .save_usage_alert(&id, &input)
            .unwrap()
            .settings
            .enabled
    );
    save.assert();
    let delete = server.mock(|when, then| {
        when.method(DELETE)
            .path(format!("/api/v1/billing/usage-alerts/{id}"));
        then.status(204);
    });
    client.billing().delete_usage_alert(&id).unwrap();
    delete.assert();
}
