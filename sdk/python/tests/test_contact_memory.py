from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from inkbox.contacts.resources.contacts import ContactsResource
from inkbox.contacts.resources.correspondence import ContactCorrespondenceOptions
from inkbox.contacts.types import (
    CallCorrespondenceItem,
    Contact,
    ContactBulkDeleteStatus,
    ContactFact,
    ContactFactKind,
    ContactImportResult,
    ContactReviewStatus,
    CorrespondenceChannel,
    EmailCorrespondenceItem,
    IMessageCorrespondenceItem,
    SmsCorrespondenceItem,
    SlackCorrespondenceItem,
)

CONTACT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
IDENTITY_ID = "bbbbbbbb-0000-0000-0000-000000000001"
SOURCE_ID = "cccccccc-0000-0000-0000-000000000001"
NOW = "2026-07-20T12:00:00+00:00"


def contact_payload():
    return {
        "id": CONTACT_ID,
        "organization_id": "org_test",
        "preferred_name": "Alex",
        "name_prefix": None,
        "given_name": "Alex",
        "middle_name": None,
        "family_name": None,
        "name_suffix": None,
        "company_name": None,
        "job_title": None,
        "birthday": None,
        "notes": None,
        "emails": [],
        "phones": [],
        "websites": [],
        "dates": [],
        "addresses": [],
        "custom_fields": [],
        "access": [],
        "creation_source": "communication",
        "review_status": "unreviewed",
        "reviewed_at": None,
        "reviewed_by": None,
        "preferred_name_source": "mail_header",
        "preferred_name_locked_at": None,
        "created_by_identity_id": IDENTITY_ID,
        "merged_into_contact_id": None,
        "is_auto_created": True,
        "is_confirmed": False,
        "memory_count": 3,
        "latest_memory": {"id": SOURCE_ID, "content": "Prefers email", "updated_at": NOW},
        "status": "active",
        "created_at": NOW,
        "updated_at": NOW,
    }


def test_contact_lifecycle_and_review_filtering():
    transport = MagicMock()
    transport.get.return_value = [contact_payload()]
    resource = ContactsResource(transport)

    contacts = resource.list(review_status=[ContactReviewStatus.UNREVIEWED])

    assert contacts[0].is_auto_created is True
    assert contacts[0].created_by_identity_id is not None
    assert contacts[0].memory_count == 3
    assert contacts[0].latest_memory.content == "Prefers email"
    assert transport.get.call_args.kwargs["params"]["review_status"] == ["unreviewed"]

    transport.get.return_value = contact_payload()
    resource.get(CONTACT_ID)
    transport.get.assert_called_with(f"/contacts/{CONTACT_ID}")


def test_update_review_status_and_merge():
    transport = MagicMock()
    transport.patch.return_value = contact_payload()
    transport.post.return_value = contact_payload()
    resource = ContactsResource(transport)

    resource.update(CONTACT_ID, review_status=ContactReviewStatus.CONFIRMED)
    assert transport.patch.call_args.kwargs["json"] == {"review_status": "confirmed"}

    survivor = resource.merge(
        CONTACT_ID, losing_contact_ids=[SOURCE_ID], field_sources={"notes": SOURCE_ID}
    )
    assert survivor.memory_count == 3
    assert survivor.latest_memory.content == "Prefers email"
    assert transport.post.call_args.kwargs["json"] == {
        "losing_contact_ids": [SOURCE_ID],
        "field_sources": {"notes": SOURCE_ID},
    }


def test_facts_and_citation_parsing():
    transport = MagicMock()
    transport.get.return_value = [
        {
            "id": SOURCE_ID,
            "contact_id": CONTACT_ID,
            "content": "Prefers email",
            "confidence": "0.95",
            "origin": "generated",
            "locked_at": None,
            "created_at": NOW,
            "updated_at": NOW,
            "citations": [
                {
                    "source_type": "email",
                    "availability": "available",
                    "source_id": SOURCE_ID,
                    "source_url": "/citation",
                    "source_locator": {"part": "body"},
                }
            ],
        }
    ]
    resource = ContactsResource(transport)

    facts = resource.facts.list(CONTACT_ID)
    assert str(facts[0].confidence) == "0.95"
    assert facts[0].citations[0].source_id is not None
    assert facts[0].kind is None
    assert facts[0].expires_at is None
    transport.get.assert_called_with(f"/contacts/{CONTACT_ID}/facts", params={})

    transport.get.return_value = {
        "source_type": "email",
        "source_id": SOURCE_ID,
        "source_locator": {"part": "body"},
        "source_url": None,
    }
    detail = resource.facts.resolve_citation(CONTACT_ID, SOURCE_ID, SOURCE_ID)
    assert detail.source_locator == {"part": "body"}


def fact_payload(**overrides):
    payload = {
        "id": SOURCE_ID,
        "contact_id": CONTACT_ID,
        "content": "Prefers email",
        "confidence": None,
        "origin": "user",
        "kind": "preference",
        "expires_at": None,
        "locked_at": None,
        "created_at": NOW,
        "updated_at": NOW,
        "citations": [],
    }
    payload.update(overrides)
    return payload


def test_fact_kind_and_expiry_parsing():
    transport = MagicMock()
    expires_at = "2026-08-19T12:00:00+00:00"
    transport.get.return_value = [
        fact_payload(origin="generated", kind="context", expires_at=expires_at)
    ]
    resource = ContactsResource(transport)

    facts = resource.facts.list(CONTACT_ID, include_expired=True)

    assert facts[0].kind is ContactFactKind.CONTEXT
    assert facts[0].expires_at == datetime.fromisoformat(expires_at)
    assert transport.get.call_args.kwargs["params"] == {"include_expired": True}


def test_fact_fields_tolerate_servers_without_them():
    fact = ContactFact._from_dict({
        "id": SOURCE_ID,
        "contact_id": CONTACT_ID,
        "content": "Prefers email",
        "confidence": None,
        "origin": "generated",
        "locked_at": None,
        "created_at": NOW,
        "updated_at": NOW,
    })

    assert fact.kind is None
    assert fact.expires_at is None


def test_fact_create_and_update():
    transport = MagicMock()
    transport.post.return_value = fact_payload()
    transport.patch.return_value = fact_payload(content="Prefers SMS")
    resource = ContactsResource(transport)

    created = resource.facts.create(
        CONTACT_ID, content="Prefers email", kind=ContactFactKind.PREFERENCE
    )
    assert created.kind is ContactFactKind.PREFERENCE
    assert transport.post.call_args.args[0] == f"/contacts/{CONTACT_ID}/facts"
    assert transport.post.call_args.kwargs["json"] == {
        "content": "Prefers email",
        "kind": "preference",
    }

    updated = resource.facts.update(CONTACT_ID, SOURCE_ID, content="Prefers SMS")
    assert updated.content == "Prefers SMS"
    assert updated.origin.value == "user"
    assert updated.expires_at is None
    assert transport.patch.call_args.args[0] == (
        f"/contacts/{CONTACT_ID}/facts/{SOURCE_ID}"
    )
    assert transport.patch.call_args.kwargs["json"] == {"content": "Prefers SMS"}

    resource.facts.update(CONTACT_ID, SOURCE_ID, kind="profile")
    assert transport.patch.call_args.kwargs["json"] == {"kind": "profile"}

    with pytest.raises(ValueError):
        resource.facts.update(CONTACT_ID, SOURCE_ID)


def test_correspondence_options_and_all_channels():
    common = {
        "source_id": SOURCE_ID,
        "direction": "inbound",
        "occurred_at": NOW,
        "identity_id": IDENTITY_ID,
        "status": "delivered",
        "detail_url": "/detail",
    }
    transport = MagicMock()
    transport.get.return_value = {
        "contact_id": CONTACT_ID,
        "identity_id": IDENTITY_ID,
        "items": [
            {
                **common,
                "channel": "email",
                "mailbox_email": "agent@example.com",
                "from_address": "alex@example.com",
                "to_addresses": ["agent@example.com"],
                "attachments": [
                    {"filename": "a.txt", "content_type": "text/plain", "size": 2}
                ],
            },
            {
                **common,
                "channel": "sms",
                "conversation_id": SOURCE_ID,
                "local_resource_id": SOURCE_ID,
                "local_phone_number": "+15550000001",
                "participants": ["+15550000002"],
                "matched_contact_phone": "+15550000002",
                "is_group": False,
                "media": {"count": 1},
            },
            {
                **common,
                "channel": "imessage",
                "conversation_id": SOURCE_ID,
                "remote_handle": "+15550000002",
                "service": "imessage",
            },
            {
                **common,
                "channel": "calls",
                "remote_phone_number": "+15550000002",
                "started_at": NOW,
                "transcript": [{"id": SOURCE_ID, "seq": 0, "text": "Hello"}],
            },
            {
                **common,
                "channel": "slack",
                "connection_id": SOURCE_ID,
                "conversation_id": "C123",
                "workspace_id": "T123",
                "user_id": "U123",
                "message_ts": "1784548800.123456",
                "thread_ts": "1784548700.000001",
                "text": "Hello",
                "text_truncated": True,
                "media": {"count": 2},
                "sender_access": "sponsored",
            },
        ],
        "channels": [{"channel": "email", "status": "available", "returned": 1}],
        "next_cursor": "next",
    }
    resource = ContactsResource(transport)
    options = ContactCorrespondenceOptions(
        channels=[CorrespondenceChannel.EMAIL, CorrespondenceChannel.CALLS],
        after=datetime(2026, 7, 1, tzinfo=timezone.utc),
        identity_id=IDENTITY_ID,
    )

    result = resource.correspondence.get(CONTACT_ID, options)

    assert isinstance(result.items[0], EmailCorrespondenceItem)
    assert isinstance(result.items[1], SmsCorrespondenceItem)
    assert isinstance(result.items[2], IMessageCorrespondenceItem)
    assert isinstance(result.items[3], CallCorrespondenceItem)
    assert result.items[3].transcript[0].text == "Hello"
    slack = result.items[4]
    assert isinstance(slack, SlackCorrespondenceItem)
    assert slack.connection_id == UUID(SOURCE_ID)
    assert slack.conversation_id == "C123"
    assert (slack.workspace_id, slack.user_id) == ("T123", "U123")
    assert (slack.message_ts, slack.thread_ts) == ("1784548800.123456", "1784548700.000001")
    assert slack.occurred_at == datetime.fromisoformat(NOW)
    assert slack.text == "Hello" and slack.text_truncated
    assert slack.media.count == 2
    assert slack.sender_access == "sponsored"
    assert transport.get.call_args.kwargs["params"]["channels"] == "email,calls"


def test_contact_type_is_publicly_importable():
    from inkbox import Contact as ExportedContact

    assert ExportedContact is Contact


def test_contact_mutation_parity():
    transport = MagicMock()
    transport.post.side_effect = [contact_payload(), {
        "deleted_count": 1,
        "error_count": 0,
        "results": [{"contact_id": CONTACT_ID, "status": "deleted", "error": None}],
    }]
    transport.patch.return_value = contact_payload()
    resource = ContactsResource(transport)

    resource.create(given_name="Alex")
    assert transport.post.call_args_list[0].kwargs["json"] == {"given_name": "Alex"}
    resource.update(CONTACT_ID, notes="Updated")
    assert transport.patch.call_args.kwargs["json"] == {"notes": "Updated"}
    resource.delete(CONTACT_ID)
    transport.delete.assert_called_once_with(f"/contacts/{CONTACT_ID}")
    result = resource.bulk_delete([CONTACT_ID])
    assert result.deleted_count == 1
    assert result.results[0].status is ContactBulkDeleteStatus.DELETED


def test_fact_delete_citation_url_and_vcard_batch_operations():
    transport = MagicMock()
    transport.get.return_value = {
        "source_type": "email",
        "source_id": SOURCE_ID,
        "source_locator": {"part": "body"},
        "source_url": None,
    }
    transport.delete_with_response.return_value = {
        "deleted_fact_id": SOURCE_ID,
        "memory_count": 0,
        "latest_memory": None,
    }
    transport.post.return_value = {
        "content_type": "text/vcard; charset=utf-8",
        "contact_count": 1,
        "vcard": "BEGIN:VCARD\r\nEND:VCARD\r\n",
    }
    transport.post_bytes.return_value = {
        "created_count": 0,
        "error_count": 0,
        "results": [],
    }
    resource = ContactsResource(transport)

    resource.facts.resolve_citation_url(
        f"https://inkbox.ai/api/v1/contacts/{CONTACT_ID}/facts/{SOURCE_ID}/citations/{SOURCE_ID}?view=source"
    )
    transport.get.assert_called_with(
        f"/contacts/{CONTACT_ID}/facts/{SOURCE_ID}/citations/{SOURCE_ID}?view=source"
    )
    deleted = resource.facts.delete(CONTACT_ID, SOURCE_ID)
    assert str(deleted.deleted_fact_id) == SOURCE_ID
    assert deleted.latest_memory is None
    exported = resource.vcards.export_vcards([CONTACT_ID])
    assert exported.contact_count == 1
    resource.vcards.import_vcards("BEGIN:VCARD\r\nEND:VCARD\r\n")
    assert transport.post_bytes.call_args.kwargs["content_type"] == "text/vcard"


def test_vcard_import_separates_conflicts_from_errors():
    result = ContactImportResult._from_dict({
        "created_count": 0,
        "error_count": 2,
        "results": [
            {
                "index": 0,
                "status": "conflict",
                "error": "identifier conflict",
                "conflicting_contact_id": CONTACT_ID,
            },
            {"index": 1, "status": "error", "error": "invalid card"},
        ],
    })

    assert [item.index for item in result.conflicts] == [0]
    assert [item.index for item in result.errors] == [1]


def test_contact_result_types_are_publicly_importable():
    from inkbox.contacts import ContactImportResultItem as ExportedImportResultItem
    from inkbox.contacts import ContactImportResult as ExportedImportResult

    assert ExportedImportResult is ContactImportResult
    assert ExportedImportResultItem.__name__ == "ContactImportResultItem"


@pytest.mark.parametrize("channels, expected", [
    (None, "email,sms,imessage,calls,slack"),
    ([CorrespondenceChannel.SLACK], "slack"),
    (["email", "sms"], "email,sms"),
])
def test_correspondence_default_channels_and_explicit_subsets(channels, expected):
    transport = MagicMock()
    transport.get.return_value = {
        "contact_id": CONTACT_ID, "identity_id": IDENTITY_ID,
        "items": [], "channels": [], "next_cursor": None,
    }
    options = None if channels is None else ContactCorrespondenceOptions(channels=channels)
    ContactsResource(transport).correspondence.get(CONTACT_ID, options)
    assert transport.get.call_args.kwargs["params"]["channels"] == expected


@pytest.mark.parametrize("optional", [{}, {
    "thread_ts": None, "text": None, "media": None, "sender_access": None,
}])
def test_slack_correspondence_metadata_and_public_export(optional):
    from inkbox import SlackCorrespondenceItem as ExportedItem
    from inkbox.contacts.types import ContactCorrespondence

    result = ContactCorrespondence._from_dict({
        "contact_id": CONTACT_ID, "identity_id": IDENTITY_ID,
        "items": [{
            "channel": "slack", "source_id": SOURCE_ID, "identity_id": IDENTITY_ID,
            "direction": "inbound", "occurred_at": NOW,
            "connection_id": SOURCE_ID, "conversation_id": "D123",
            "workspace_id": "T123", "user_id": "U123", "message_ts": "1784548800.123456",
            **optional,
        }],
    })
    item = result.items[0]
    assert isinstance(item, ExportedItem)
    assert item.text is item.thread_ts is item.media is item.sender_access is None
    assert not item.text_truncated
