use inkbox::contacts::CorrespondenceTranscriptEntry;
use inkbox::phone::PhoneTranscript;
use inkbox::webhooks::types::WebhookTranscriptEntry;
use serde_json::{json, Value};

#[test]
fn turn_phone_numbers_survive_all_transcript_shapes() {
    let rows: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phone_transcript_numbers.json"
    ))
    .unwrap();
    let turns: Vec<PhoneTranscript> = rows
        .iter()
        .map(|row| serde_json::from_value(row.clone()).unwrap())
        .collect();
    assert_eq!(turns[0].party, turns[1].party);
    assert_ne!(turns[0].phone_number, turns[1].phone_number);
    for (row, turn) in rows.iter().zip(turns.iter()) {
        assert_eq!(turn.text, row["text"].as_str().unwrap());
        assert_eq!(turn.phone_number.as_deref(), row["phone_number"].as_str());
        assert_eq!(serde_json::to_value(turn).unwrap(), *row);
        let correspondence: CorrespondenceTranscriptEntry =
            serde_json::from_value(row.clone()).unwrap();
        let webhook: WebhookTranscriptEntry = serde_json::from_value(row.clone()).unwrap();
        assert_eq!(turn.phone_number, correspondence.phone_number);
        assert_eq!(turn.phone_number, webhook.phone_number);
    }
    let marker: WebhookTranscriptEntry =
        serde_json::from_value(json!({"marker": "abridged"})).unwrap();
    assert!(marker.phone_number.is_none());
}

#[test]
fn dedicated_local_number_and_unavailable_attribution() {
    let rows: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phone_transcript_numbers.json"
    ))
    .unwrap();
    let mut dedicated = rows[2].clone();
    dedicated["phone_number"] = json!("+14155550102");
    let turn: PhoneTranscript = serde_json::from_value(dedicated).unwrap();
    assert_eq!(turn.phone_number.as_deref(), Some("+14155550102"));
    let mut old = rows[0].clone();
    old.as_object_mut().unwrap().remove("phone_number");
    let mut unknown = rows[0].clone();
    unknown["phone_number"] = Value::Null;
    for row in [old, unknown, rows[2].clone()] {
        let turn: PhoneTranscript = serde_json::from_value(row.clone()).unwrap();
        let correspondence: CorrespondenceTranscriptEntry =
            serde_json::from_value(row.clone()).unwrap();
        let webhook: WebhookTranscriptEntry = serde_json::from_value(row).unwrap();
        assert!(turn.phone_number.is_none());
        assert!(correspondence.phone_number.is_none());
        assert!(webhook.phone_number.is_none());
    }
}
