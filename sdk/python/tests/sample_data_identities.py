"""Sample API response dicts for identities tests."""

IDENTITY_DICT = {
    "id": "eeee5555-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "agent_handle": "sales-agent",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_MAILBOX_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "email_address": "sales-agent@inkbox.ai",
    "display_name": "Sales Agent",
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

IDENTITY_WALLET_DICT = {
    "id": "ffff6666-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "status": "active",
    "addresses": {
        "evm": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    },
    "chains": [
        {"chain": "base"},
        {"chain": "tempo"},
    ],
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_DETAIL_DICT = {
    **IDENTITY_DICT,
    "wallet_id": IDENTITY_WALLET_DICT["id"],
    "mailbox": IDENTITY_MAILBOX_DICT,
    "phone_number": IDENTITY_PHONE_DICT,
    "wallet": IDENTITY_WALLET_DICT,
}
