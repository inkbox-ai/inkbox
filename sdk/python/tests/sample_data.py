"""Sample API response dicts for tests."""

PHONE_NUMBER_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "number": "+18335794607",
    "type": "toll_free",
    "status": "active",
    "incoming_call_action": "auto_reject",
    "client_websocket_url": None,
    "incoming_call_webhook_url": None,
    "incoming_text_webhook_url": None,
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

PHONE_CALL_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15167251294",
    "direction": "outbound",
    "status": "completed",
    "client_websocket_url": "wss://agent.example.com/ws",
    "use_inkbox_tts": None,
    "use_inkbox_stt": None,
    "hangup_reason": None,
    "started_at": "2026-03-09T00:01:00Z",
    "ended_at": "2026-03-09T00:05:00Z",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:05:00Z",
}

TEXT_MESSAGE_DICT = {
    "id": "dddd4444-0000-0000-0000-000000000001",
    "direction": "inbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15167251294",
    "text": "Hello, is this support?",
    "type": "sms",
    "media": None,
    "is_read": False,
    "created_at": "2026-03-09T00:10:00Z",
    "updated_at": "2026-03-09T00:10:00Z",
}

TEXT_MESSAGE_MMS_DICT = {
    "id": "dddd4444-0000-0000-0000-000000000002",
    "direction": "inbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15167251294",
    "text": "Check this out",
    "type": "mms",
    "media": [
        {
            "content_type": "image/jpeg",
            "size": 534972,
            "url": "https://s3.example.com/media/photo.jpg?signed=1",
        },
    ],
    "is_read": True,
    "created_at": "2026-03-09T00:12:00Z",
    "updated_at": "2026-03-09T00:12:00Z",
}

TEXT_MESSAGE_OUTBOUND_QUEUED_DICT = {
    "id": "dddd4444-0000-0000-0000-0000000000ff",
    "direction": "outbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15167251294",
    "text": "Hello from Inkbox",
    "type": "sms",
    "media": None,
    "is_read": True,
    "delivery_status": "queued",
    "origin": "user_initiated",
    "error_code": None,
    "error_detail": None,
    "sent_at": None,
    "delivered_at": None,
    "failed_at": None,
    "created_at": "2026-03-09T00:20:00Z",
    "updated_at": "2026-03-09T00:20:00Z",
}

TEXT_CONVERSATION_SUMMARY_DICT = {
    "remote_phone_number": "+15167251294",
    "latest_text": "Hello, is this support?",
    "latest_direction": "inbound",
    "latest_type": "sms",
    "latest_message_at": "2026-03-09T00:10:00Z",
    "unread_count": 3,
    "total_count": 15,
}

PHONE_TRANSCRIPT_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "call_id": "bbbb2222-0000-0000-0000-000000000001",
    "seq": 0,
    "ts_ms": 1500,
    "party": "local",
    "text": "Hello, how can I help you?",
    "created_at": "2026-03-09T00:01:01Z",
}
