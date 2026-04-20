"""
sdk/python/tests/test_contacts_notes.py

Unit tests for the Contacts and Notes SDK resources.
"""

from unittest.mock import MagicMock

import pytest

from inkbox.contacts.resources.contact_access import ContactAccessResource
from inkbox.contacts.resources.contacts import ContactsResource
from inkbox.contacts.resources.vcards import VCardsResource
from inkbox.contacts.types import (
    Contact,
    ContactEmail,
    ContactImportResult,
    ContactPhone,
)
from inkbox.notes.resources.notes import NotesResource
from inkbox.notes.types import Note


CONTACT_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "organization_id": "org_test",
    "preferred_name": "Alex",
    "name_prefix": None,
    "given_name": "Alex",
    "middle_name": None,
    "family_name": "Waugh",
    "name_suffix": None,
    "company_name": None,
    "job_title": None,
    "birthday": "1990-01-01",
    "notes": None,
    "emails": [{"label": "work", "value": "alex@example.com", "is_primary": True}],
    "phones": [{"value": "+15551234567"}],
    "websites": [],
    "dates": [{"label": "anniversary", "value": "2020-06-15"}],
    "addresses": [],
    "custom_fields": [],
    "access": [
        {
            "id": "bbbb2222-0000-0000-0000-000000000001",
            "contact_id": "aaaa1111-0000-0000-0000-000000000001",
            "identity_id": None,
            "created_at": "2026-04-20T00:00:00Z",
        },
    ],
    "status": "active",
    "created_at": "2026-04-20T00:00:00Z",
    "updated_at": "2026-04-20T00:00:00Z",
}

NOTE_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "organization_id": "org_test",
    "created_by": "user_test",
    "title": "Design doc",
    "body": "Some body text",
    "status": "active",
    "access": [],
    "created_at": "2026-04-20T00:00:00Z",
    "updated_at": "2026-04-20T00:00:00Z",
}


@pytest.fixture
def transport():
    t = MagicMock()
    t.get = MagicMock()
    t.post = MagicMock()
    t.patch = MagicMock()
    t.delete = MagicMock()
    t.post_bytes = MagicMock()
    t.get_bytes = MagicMock()
    return t


class TestContactsParse:
    def test_contact_inlines_access(self):
        c = Contact._from_dict(CONTACT_DICT)
        assert len(c.access) == 1
        assert c.access[0].identity_id is None  # wildcard

    def test_contact_email_round_trips(self):
        c = Contact._from_dict(CONTACT_DICT)
        assert c.emails[0].is_primary is True

    def test_empty_access_is_zero_grants_not_unloaded(self):
        c = Contact._from_dict({**CONTACT_DICT, "access": []})
        assert c.access == []

    def test_all_name_fields_and_birthday_present(self):
        from datetime import date

        d = {
            **CONTACT_DICT,
            "name_prefix": "Dr.",
            "middle_name": "Quincy",
            "name_suffix": "Jr.",
        }
        c = Contact._from_dict(d)
        assert c.name_prefix == "Dr."
        assert c.middle_name == "Quincy"
        assert c.name_suffix == "Jr."
        assert c.birthday == date(1990, 1, 1)
        assert c.organization_id == "org_test"
        assert c.status == "active"

    def test_birthday_null_parses_to_none(self):
        c = Contact._from_dict({**CONTACT_DICT, "birthday": None})
        assert c.birthday is None


class TestContactsListAndLookup:
    def test_list_with_q_and_order(self, transport):
        transport.get.return_value = {"items": [CONTACT_DICT]}
        resource = ContactsResource(transport)

        rows = resource.list(q="al", order="name", limit=25, offset=0)

        transport.get.assert_called_once_with(
            "/contacts",
            params={"q": "al", "order": "name", "limit": 25, "offset": 0},
        )
        assert len(rows) == 1

    def test_lookup_requires_exactly_one_filter(self, transport):
        resource = ContactsResource(transport)
        with pytest.raises(ValueError):
            resource.lookup()
        with pytest.raises(ValueError):
            resource.lookup(email="a@b.com", phone="+15551234567")

    def test_lookup_single_filter_passes_through(self, transport):
        transport.get.return_value = [CONTACT_DICT]
        resource = ContactsResource(transport)

        resource.lookup(email_domain="example.com")

        transport.get.assert_called_once_with(
            "/contacts/lookup",
            params={"email_domain": "example.com"},
        )


class TestContactsCreate:
    def test_wildcard_default_omits_access_ids(self, transport):
        transport.post.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.create(
            preferred_name="Alex",
            emails=[ContactEmail(label="work", value="a@b.com", is_primary=True)],
            phones=[ContactPhone(label=None, value="+15551234567")],
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["preferred_name"] == "Alex"
        assert kwargs["json"]["emails"] == [
            {"value": "a@b.com", "label": "work", "is_primary": True},
        ]
        assert "access_identity_ids" not in kwargs["json"]

    def test_explicit_empty_list_sends_empty_grants(self, transport):
        transport.post.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.create(access_identity_ids=[])

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["access_identity_ids"] == []

    def test_none_explicit_forces_null(self, transport):
        transport.post.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.create(access_identity_ids=None)

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["access_identity_ids"] is None

    def test_all_name_fields_and_birthday_serialize(self, transport):
        from datetime import date

        transport.post.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.create(
            preferred_name="Alex",
            name_prefix="Dr.",
            given_name="Alex",
            middle_name="Q",
            family_name="Waugh",
            name_suffix="Jr.",
            birthday=date(1990, 1, 1),
        )

        _, kwargs = transport.post.call_args
        body = kwargs["json"]
        assert body["name_prefix"] == "Dr."
        assert body["middle_name"] == "Q"
        assert body["name_suffix"] == "Jr."
        assert body["birthday"] == "1990-01-01"

    def test_birthday_accepts_iso_string(self, transport):
        transport.post.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.create(preferred_name="Alex", birthday="1990-01-01")

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["birthday"] == "1990-01-01"


class TestContactsUpdate:
    def test_merge_patch_only_sends_supplied_fields(self, transport):
        transport.patch.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.update("aaaa1111-0000-0000-0000-000000000001", notes="updated")

        _, kwargs = transport.patch.call_args
        assert kwargs["json"] == {"notes": "updated"}

    def test_null_list_clears_column(self, transport):
        transport.patch.return_value = CONTACT_DICT
        resource = ContactsResource(transport)

        resource.update("aaaa1111-0000-0000-0000-000000000001", emails=None)

        _, kwargs = transport.patch.call_args
        assert kwargs["json"]["emails"] is None


class TestContactAccess:
    def test_grant_wildcard(self, transport):
        transport.post.return_value = {
            "id": "bbbb2222-0000-0000-0000-000000000010",
            "contact_id": "aaaa1111-0000-0000-0000-000000000001",
            "identity_id": None,
            "created_at": "2026-04-20T00:00:00Z",
        }
        access = ContactAccessResource(transport)

        access.grant("aaaa1111-0000-0000-0000-000000000001", wildcard=True)

        _, kwargs = transport.post.call_args
        assert kwargs["json"] == {"identity_id": None}

    def test_grant_per_identity(self, transport):
        transport.post.return_value = {
            "id": "bbbb2222-0000-0000-0000-000000000011",
            "contact_id": "aaaa1111-0000-0000-0000-000000000001",
            "identity_id": "dddd4444-0000-0000-0000-000000000001",
            "created_at": "2026-04-20T00:00:00Z",
        }
        access = ContactAccessResource(transport)

        access.grant(
            "aaaa1111-0000-0000-0000-000000000001",
            identity_id="dddd4444-0000-0000-0000-000000000001",
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"] == {
            "identity_id": "dddd4444-0000-0000-0000-000000000001",
        }

    def test_wildcard_plus_identity_rejects(self, transport):
        access = ContactAccessResource(transport)
        with pytest.raises(ValueError):
            access.grant(
                "aaaa1111-0000-0000-0000-000000000001",
                identity_id="dddd4444-0000-0000-0000-000000000001",
                wildcard=True,
            )


class TestVCards:
    def test_import_posts_bytes(self, transport):
        transport.post_bytes.return_value = {
            "created_count": 1,
            "error_count": 1,
            "results": [
                {"index": 0, "status": "created", "contact": CONTACT_DICT, "error": None},
                {"index": 1, "status": "error", "contact": None, "error": "bad FN"},
            ],
        }
        resource = VCardsResource(transport)

        result = resource.import_vcards("BEGIN:VCARD\r\nEND:VCARD\r\n")

        transport.post_bytes.assert_called_once()
        args, kwargs = transport.post_bytes.call_args
        assert args == ("/contacts/import",)
        assert kwargs["content_type"] == "text/vcard"
        assert isinstance(kwargs["content"], bytes)
        assert isinstance(result, ContactImportResult)
        assert result.created_count == 1
        assert result.error_count == 1
        assert len(result.results) == 2
        assert result.results[0].status == "created"
        assert result.results[0].contact is not None
        assert result.results[1].status == "error"
        assert result.results[1].error == "bad FN"
        # Convenience properties
        assert len(result.created_ids) == 1
        assert len(result.errors) == 1
        assert result.errors[0].index == 1

    def test_export_returns_text(self, transport):
        transport.get_bytes.return_value = b"BEGIN:VCARD\r\nEND:VCARD\r\n"
        resource = VCardsResource(transport)

        text = resource.export_vcard("aaaa1111-0000-0000-0000-000000000001")

        transport.get_bytes.assert_called_once_with(
            "/contacts/aaaa1111-0000-0000-0000-000000000001.vcf",
            accept="text/vcard",
        )
        assert "BEGIN:VCARD" in text

    def test_import_then_export_round_trip(self, transport):
        # Import returns one successful card, then export that card: the
        # two resource calls should be wired to separate transport methods
        # and compose into a single logical round-trip.
        transport.post_bytes.return_value = {
            "created_count": 1,
            "error_count": 0,
            "results": [
                {"index": 0, "status": "created", "contact": CONTACT_DICT, "error": None},
            ],
        }
        transport.get_bytes.return_value = b"BEGIN:VCARD\r\nFN:Alex\r\nEND:VCARD\r\n"
        resource = VCardsResource(transport)

        result = resource.import_vcards("BEGIN:VCARD\r\nFN:Alex\r\nEND:VCARD\r\n")
        assert len(result.created_ids) == 1
        created = result.results[0].contact
        assert created is not None

        vcf = resource.export_vcard(created.id)
        assert "BEGIN:VCARD" in vcf
        assert transport.post_bytes.call_count == 1
        assert transport.get_bytes.call_count == 1


class TestNotes:
    def test_list_includes_identity_filter(self, transport):
        transport.get.return_value = {"items": [NOTE_DICT]}
        resource = NotesResource(transport)

        resource.list(
            q="design",
            identity_id="dddd4444-0000-0000-0000-000000000001",
            limit=50,
            order="recent",
        )

        transport.get.assert_called_once_with(
            "/notes",
            params={
                "q": "design",
                "identity_id": "dddd4444-0000-0000-0000-000000000001",
                "limit": 50,
                "order": "recent",
            },
        )

    def test_create_sends_body_only_when_no_title(self, transport):
        transport.post.return_value = NOTE_DICT
        resource = NotesResource(transport)

        resource.create(body="some text")

        _, kwargs = transport.post.call_args
        assert kwargs["json"] == {"body": "some text"}

    def test_update_title_null_is_valid(self, transport):
        transport.patch.return_value = {**NOTE_DICT, "title": None}
        resource = NotesResource(transport)

        resource.update("cccc3333-0000-0000-0000-000000000001", title=None)

        _, kwargs = transport.patch.call_args
        assert kwargs["json"] == {"title": None}

    def test_note_parse(self):
        n = Note._from_dict(NOTE_DICT)
        assert n.title == "Design doc"
        assert n.access == []
        assert n.organization_id == "org_test"
        assert n.created_by == "user_test"
        assert n.status == "active"

    def test_note_parse_missing_required_field_raises(self):
        # Guards against silently dropping server fields — if the server
        # response ever omits one of these required fields, we want to fail
        # fast rather than dereference an undefined value later.
        import pytest as _pytest

        bad = {k: v for k, v in NOTE_DICT.items() if k != "organization_id"}
        with _pytest.raises(KeyError):
            Note._from_dict(bad)
