use inkbox::contacts::CorrespondenceTranscriptEntry;
use inkbox::phone::{PhoneTranscript, PhoneTranscriptSpeaker, PhoneTranscriptSpeakerKind};
use inkbox::webhooks::types::WebhookTranscriptEntry;
use serde_json::{json, Value};

#[test]
fn speaker_snapshots_survive_all_transcript_shapes() {
    let rows: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phone_transcript_speakers.json"
    ))
    .unwrap();
    let turns: Vec<PhoneTranscript> = rows
        .iter()
        .map(|row| serde_json::from_value(row.clone()).unwrap())
        .collect();
    assert_eq!(turns[0].party, turns[1].party);
    assert_ne!(
        turns[0].speaker.as_ref().unwrap().id,
        turns[1].speaker.as_ref().unwrap().id
    );
    assert_eq!(
        turns[2].speaker.as_ref().unwrap().kind,
        PhoneTranscriptSpeakerKind::Agent
    );
    for (row, turn) in rows.iter().zip(turns.iter()) {
        assert_eq!(turn.text, row["text"].as_str().unwrap());
        assert_eq!(turn.phone_number.as_deref(), row["phone_number"].as_str());
        let correspondence: CorrespondenceTranscriptEntry =
            serde_json::from_value(row.clone()).unwrap();
        let webhook: WebhookTranscriptEntry = serde_json::from_value(row.clone()).unwrap();
        assert_eq!(turn.phone_number, correspondence.phone_number);
        assert_eq!(turn.phone_number, webhook.phone_number);
        assert_eq!(
            serde_json::to_value(&turn.speaker).unwrap(),
            serde_json::to_value(&correspondence.speaker).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&turn.speaker).unwrap(),
            serde_json::to_value(&webhook.speaker).unwrap()
        );
    }
    assert!(turns[3].speaker.is_none());
    let mut old = rows[3].clone();
    old.as_object_mut().unwrap().remove("speaker");
    assert!(serde_json::from_value::<PhoneTranscript>(old)
        .unwrap()
        .speaker
        .is_none());
    let marker: WebhookTranscriptEntry =
        serde_json::from_value(json!({"marker": "abridged"})).unwrap();
    assert!(marker.speaker.is_none());
    assert!(marker.phone_number.is_none());
}

#[test]
fn turn_phone_number_is_nullable_and_not_inferred_from_snapshot() {
    let rows: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/phone_transcript_speakers.json"
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

#[test]
fn sparse_speaker_keeps_unknown_facts_absent() {
    let speaker: PhoneTranscriptSpeaker = serde_json::from_value(json!({
        "id": "11111111-1111-5111-8111-111111111111", "kind": "human"
    }))
    .unwrap();
    assert!(speaker.name.is_none());
    assert!(speaker.phone_number.is_none());
    assert!(speaker.contact_id.is_none());
    assert!(speaker.agent_identity_id.is_none());
}
