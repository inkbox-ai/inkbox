"""Sample API response dicts for identities tests."""

IDENTITY_DICT = {
    "id": "eeee5555-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "agent_handle": "sales-agent",
    "status": "active",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_MAILBOX_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "email_address": "sales-agent@inkbox.ai",
    "display_name": "Sales Agent",
    "status": "active",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_PHONE_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "number": "+18335794607",
    "type": "toll_free",
    "status": "active",
    "incoming_call_action": "auto_reject",
    "client_websocket_url": None,
    "incoming_text_webhook_url": None,
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_DETAIL_DICT = {
    **IDENTITY_DICT,
    "mailbox": IDENTITY_MAILBOX_DICT,
    "phone_number": IDENTITY_PHONE_DICT,
}
