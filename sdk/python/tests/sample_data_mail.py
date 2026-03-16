"""Sample API response dicts for mail tests."""

MAILBOX_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "email_address": "agent01@inkbox.ai",
    "display_name": "Agent 01",
    "status": "active",
    "created_at": "2026-03-09T00:00:00Z",
    "updated_at": "2026-03-09T00:00:00Z",
}

MESSAGE_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "mailbox_id": "aaaa1111-0000-0000-0000-000000000001",
    "thread_id": "eeee5555-0000-0000-0000-000000000001",
    "message_id": "<abc123@mail.gmail.com>",
    "from_address": "user@example.com",
    "to_addresses": ["agent01@inkbox.ai"],
    "cc_addresses": None,
    "subject": "Hello from test",
    "snippet": "Hi there, this is a test message...",
    "direction": "inbound",
    "status": "delivered",
    "is_read": False,
    "is_starred": False,
    "has_attachments": False,
    "created_at": "2026-03-09T00:00:00Z",
}

MESSAGE_DETAIL_DICT = {
    **MESSAGE_DICT,
    "body_text": "Hi there, this is a test message body.",
    "body_html": "<p>Hi there, this is a test message body.</p>",
    "bcc_addresses": None,
    "in_reply_to": None,
    "references": None,
    "attachment_metadata": None,
    "ses_message_id": "ses-abc123",
    "updated_at": "2026-03-09T00:00:00Z",
}

THREAD_DICT = {
    "id": "eeee5555-0000-0000-0000-000000000001",
    "mailbox_id": "aaaa1111-0000-0000-0000-000000000001",
    "subject": "Hello from test",
    "status": "active",
    "message_count": 2,
    "last_message_at": "2026-03-09T00:05:00Z",
    "created_at": "2026-03-09T00:00:00Z",
}

THREAD_DETAIL_DICT = {
    **THREAD_DICT,
    "messages": [MESSAGE_DICT],
}

CURSOR_PAGE_MESSAGES = {
    "items": [MESSAGE_DICT],
    "next_cursor": None,
    "has_more": False,
}

CURSOR_PAGE_MESSAGES_MULTI = {
    "items": [MESSAGE_DICT],
    "next_cursor": "cursor-abc",
    "has_more": True,
}

CURSOR_PAGE_THREADS = {
    "items": [THREAD_DICT],
    "next_cursor": None,
    "has_more": False,
}

CURSOR_PAGE_SEARCH = {
    "items": [MESSAGE_DICT],
    "next_cursor": None,
    "has_more": False,
}
