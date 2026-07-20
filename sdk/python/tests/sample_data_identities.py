"""Sample API response dicts for identities tests."""

IDENTITY_DICT = {
    "id": "eeee5555-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "agent_handle": "sales-agent",
    "display_name": "Sales Agent",
    "description": None,
    "email_address": "sales-agent@inkbox.ai",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_MAILBOX_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "email_address": "sales-agent@inkbox.ai",
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

# Identity payloads embed the tunnel as a durable-config summary; the full
# tunnel (cert material, live connection state) comes from GET /tunnels/{id}.
IDENTITY_TUNNEL_DICT = {
    "id": "ffff6666-0000-0000-0000-000000000001",
    "tunnel_name": "sales-agent",
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "tls_mode": "edge",
    "status": "active",
    "public_host": "sales-agent.inkboxwire.com",
    "zone": "inkboxwire.com",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_PHONE_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "number": "+18335794607",
    "type": "local",
    "status": "active",
    "incoming_call_action": "auto_reject",
    "client_websocket_url": None,
    "incoming_call_webhook_url": None,
    "state": None,
    "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

IDENTITY_IMESSAGE_NUMBER_DICT = {
    "id": "99999999-0000-0000-0000-000000000001",
    "number": "+15551230001",
    "type": "dedicated_outbound",
}

IDENTITY_DETAIL_DICT = {
    **IDENTITY_DICT,
    "mailbox": IDENTITY_MAILBOX_DICT,
    "phone_number": IDENTITY_PHONE_DICT,
    "imessage_number": IDENTITY_IMESSAGE_NUMBER_DICT,
    "tunnel": IDENTITY_TUNNEL_DICT,
}

IDENTITY_ACCESS_WILDCARD_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "target_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "viewer_identity_id": None,
    "created_at": "2026-05-21T00:00:00Z",
}

IDENTITY_ACCESS_VIEWER_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000002",
    "target_identity_id": "eeee5555-0000-0000-0000-000000000001",
    "viewer_identity_id": "dddd4444-0000-0000-0000-000000000001",
    "created_at": "2026-05-21T00:00:00Z",
}

IDENTITY_LIST_DETAIL_DICT = {
    **IDENTITY_DETAIL_DICT,
    "access": [IDENTITY_ACCESS_WILDCARD_DICT],
}
