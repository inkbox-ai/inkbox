"""Sample API response dicts for tests."""

PHONE_NUMBER_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "number": "+18335794607",
    "type": "local",
    "status": "active",
    "sms_status": "ready",
    "sms_error_code": None,
    "sms_error_detail": None,
    "sms_ready_at": "2026-03-09T00:01:00Z",
    "incoming_call_action": "auto_reject",
    "client_websocket_url": None,
    "incoming_call_webhook_url": None,
    "state": None,
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

PHONE_CALL_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
    "direction": "outbound",
    "status": "completed",
    "client_websocket_url": "wss://agent.example.com/ws",
    "use_inkbox_tts": None,
    "use_inkbox_stt": None,
    "hangup_reason": None,
    "started_at": "2026-03-09T00:01:00Z",
    "ended_at": "2026-03-09T00:05:00Z",
    "is_blocked": False,
    "mode": "client_websocket",
    "reason": None,
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:05:00Z",
}

PHONE_CALL_BLOCKED_DICT = {
    "id": "bbbb2222-0000-0000-0000-0000000000bb",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
    "direction": "inbound",
    "status": "failed",
    "client_websocket_url": None,
    "use_inkbox_tts": None,
    "use_inkbox_stt": None,
    "hangup_reason": "rejected",
    "started_at": None,
    "ended_at": None,
    "is_blocked": True,
    "created_at": "2026-03-09T00:30:00Z",
    "updated_at": "2026-03-09T00:30:00Z",
}

TEXT_MESSAGE_DICT = {
    "id": "dddd4444-0000-0000-0000-000000000001",
    "direction": "inbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
    "text": "Hello, is this support?",
    "type": "sms",
    "media": None,
    "is_read": False,
    "is_blocked": False,
    "conversation_id": "eeee1111-0000-0000-0000-000000000001",
    "sender_phone_number": "+15551234567",
    "recipients": None,
    "created_at": "2026-03-09T00:10:00Z",
    "updated_at": "2026-03-09T00:10:00Z",
}

TEXT_MESSAGE_BLOCKED_DICT = {
    "id": "dddd4444-0000-0000-0000-0000000000bb",
    "direction": "inbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
    "text": "Buy crypto now!!!",
    "type": "sms",
    "media": None,
    "is_read": False,
    "is_blocked": True,
    "conversation_id": "eeee1111-0000-0000-0000-0000000000bb",
    "sender_phone_number": "+15551234567",
    "recipients": None,
    "created_at": "2026-03-09T00:35:00Z",
    "updated_at": "2026-03-09T00:35:00Z",
}

TEXT_MESSAGE_MMS_DICT = {
    "id": "dddd4444-0000-0000-0000-000000000002",
    "direction": "inbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
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
    "conversation_id": "eeee1111-0000-0000-0000-000000000001",
    "sender_phone_number": "+15551234567",
    "recipients": None,
    "created_at": "2026-03-09T00:12:00Z",
    "updated_at": "2026-03-09T00:12:00Z",
}

TEXT_MESSAGE_SPAM_BLOCKED_DICT = {
    "id": "dddd4444-0000-0000-0000-0000000000ee",
    "direction": "outbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
    "text": "**Bold** reads as bot traffic",
    "type": "sms",
    "media": None,
    "is_read": True,
    "delivery_status": "blocked_spam_filter",
    "origin": "user_initiated",
    "error_code": "inkbox_spam_filter",
    "error_detail": "Markdown formatting reads as bot traffic in SMS.",
    "sent_at": None,
    "delivered_at": None,
    "failed_at": "2026-03-09T00:12:00Z",
    "conversation_id": "eeee1111-0000-0000-0000-000000000001",
    "sender_phone_number": None,
    "recipients": None,
    "created_at": "2026-03-09T00:12:00Z",
    "updated_at": "2026-03-09T00:12:00Z",
}

TEXT_MESSAGE_OUTBOUND_QUEUED_DICT = {
    "id": "dddd4444-0000-0000-0000-0000000000ff",
    "direction": "outbound",
    "local_phone_number": "+18335794607",
    "remote_phone_number": "+15551234567",
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
    "conversation_id": "eeee1111-0000-0000-0000-000000000001",
    "sender_phone_number": None,
    "recipients": [
        {
            "recipient_phone_number": "+15551234567",
            "delivery_status": "queued",
            "carrier": None,
            "line_type": None,
            "error_code": None,
            "error_detail": None,
            "sent_at": None,
            "delivered_at": None,
            "failed_at": None,
        },
    ],
    "created_at": "2026-03-09T00:20:00Z",
    "updated_at": "2026-03-09T00:20:00Z",
}

TEXT_MESSAGE_GROUP_DICT = {
    **TEXT_MESSAGE_OUTBOUND_QUEUED_DICT,
    "id": "dddd4444-0000-0000-0000-0000000000fa",
    "remote_phone_number": None,
    "conversation_id": "eeee1111-0000-0000-0000-0000000000fa",
    "recipients": [
        {
            "recipient_phone_number": "+15551234567",
            "delivery_status": "queued",
            "carrier": None,
            "line_type": None,
            "error_code": None,
            "error_detail": None,
            "sent_at": None,
            "delivered_at": None,
            "failed_at": None,
        },
        {
            "recipient_phone_number": "+15557654321",
            "delivery_status": "queued",
            "carrier": None,
            "line_type": None,
            "error_code": None,
            "error_detail": None,
            "sent_at": None,
            "delivered_at": None,
            "failed_at": None,
        },
    ],
}

TEXT_CONVERSATION_SUMMARY_DICT = {
    "remote_phone_number": "+15551234567",
    "id": "eeee1111-0000-0000-0000-000000000001",
    "participants": ["+15551234567"],
    "is_group": False,
    "latest_text": "Hello, is this support?",
    "latest_direction": "inbound",
    "latest_type": "sms",
    "latest_has_media": False,
    "latest_message_at": "2026-03-09T00:10:00Z",
    "unread_count": 3,
    "total_count": 15,
}

TEXT_CONVERSATION_GROUP_SUMMARY_DICT = {
    "remote_phone_number": None,
    "id": "eeee1111-0000-0000-0000-0000000000fa",
    "participants": ["+15551234567", "+15557654321"],
    "is_group": True,
    "latest_text": "Hello group",
    "latest_direction": "outbound",
    "latest_type": "mms",
    "latest_has_media": True,
    "latest_message_at": "2026-03-09T00:20:00Z",
    "unread_count": 0,
    "total_count": 1,
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

RATE_LIMIT_INFO_DICT = {
    "calls_used": 3,
    "calls_remaining": 7,
    "calls_limit": 10,
    "minutes_used": 12.5,
    "minutes_remaining": 47.5,
    "minutes_limit": 60,
}

INCOMING_CALL_ACTION_CONFIG_DICT = {
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "incoming_call_action": "webhook",
    "client_websocket_url": None,
    "incoming_call_webhook_url": "https://hooks.example.com/incoming-call",
}

HOSTED_AGENT_CONFIG_DICT = {
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "voice": "warm-voice",
    "model": "fast-model",
    "instructions": "Always offer to text a summary after the call.",
}

POST_CALL_ACTION_DICT = {
    "id": "ffff6666-0000-0000-0000-000000000001",
    "call_id": "bbbb2222-0000-0000-0000-000000000001",
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "seq": 1,
    "action": "Book cleaning Tue 9:30am",
    "details": "Dr. Chen's office confirmed availability.",
    "status": "open",
    "created_at": "2026-03-09T00:04:00Z",
    "updated_at": "2026-03-09T00:04:00Z",
}

POST_CALL_ACTION_CANCELED_DICT = {
    "id": "ffff6666-0000-0000-0000-000000000002",
    "call_id": "bbbb2222-0000-0000-0000-000000000001",
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "seq": 2,
    "action": "Send pricing PDF",
    "details": None,
    "status": "canceled",
    "created_at": "2026-03-09T00:04:30Z",
    "updated_at": "2026-03-09T00:04:45Z",
}
