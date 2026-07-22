from datetime import datetime, timezone
from unittest.mock import MagicMock

from inkbox.contacts.resources.contacts import ContactsResource
from inkbox.contacts.resources.correspondence import ContactCorrespondenceOptions
from inkbox.contacts.types import (
    CallCorrespondenceItem,
    Contact,
    ContactBulkDeleteStatus,
    ContactImportResult,
    ContactReviewStatus,
    CorrespondenceChannel,
    EmailCorrespondenceItem,
    IMessageCorrespondenceItem,
    SmsCorrespondenceItem,
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
    transport.get.assert_called_with(f"/contacts/{CONTACT_ID}/facts")

    transport.get.return_value = {
        "source_type": "email",
        "source_id": SOURCE_ID,
        "source_locator": {"part": "body"},
        "source_url": None,
    }
    detail = resource.facts.resolve_citation(CONTACT_ID, SOURCE_ID, SOURCE_ID)
    assert detail.source_locator == {"part": "body"}


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
