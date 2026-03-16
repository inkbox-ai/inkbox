"""Sample API response dicts for tests."""

PHONE_NUMBER_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "number": "+18335794607",
    "type": "toll_free",
    "status": "active",
    "incoming_call_action": "auto_reject",
    "client_websocket_url": None,
    "incoming_call_webhook_url": None,
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

PHONE_TRANSCRIPT_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "call_id": "bbbb2222-0000-0000-0000-000000000001",
    "seq": 0,
    "ts_ms": 1500,
    "party": "local",
    "text": "Hello, how can I help you?",
    "created_at": "2026-03-09T00:01:01Z",
}
