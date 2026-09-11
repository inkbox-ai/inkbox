from uuid import UUID

import pytest

from inkbox.imessage.types import IMessageContactRule
from inkbox.mail.types import MailIdentityContactRule
from inkbox.phone.types import PhoneIdentityContactRule
from inkbox.contacts.types import ContactBulkDeleteResultItem


def test_bulk_delete_error_codes_are_optional_and_preserved():
    payload = {"contact_id": "11111111-1111-4111-8111-111111111111", "status": "error", "error": "Reset permissions first"}
    assert ContactBulkDeleteResultItem._from_dict(payload).error_code is None
    parsed = ContactBulkDeleteResultItem._from_dict({**payload, "error_code": "contact_policy_reset_required"})
    assert parsed.error_code == "contact_policy_reset_required"
    assert parsed.error == payload["error"]


@pytest.mark.parametrize("model", [MailIdentityContactRule, PhoneIdentityContactRule, IMessageContactRule])
@pytest.mark.parametrize("shape", ["absent", "null", "card", "filtered"])
def test_rule_contact_parsing(model, shape):
    payload = {
        "id": "11111111-1111-4111-8111-111111111111",
        "agent_identity_id": "22222222-2222-4222-8222-222222222222",
        "action": "allow", "status": "active",
        "match_type": "exact_email" if model is MailIdentityContactRule else "exact_number",
        "match_target": "person@example.com" if model is MailIdentityContactRule else "+15555550123",
        "created_at": "2026-09-11T00:00:00Z", "updated_at": "2026-09-11T00:00:00Z",
    }
    if shape != "absent":
        payload["contact"] = None
    if shape in ("card", "filtered"):
        payload["contact"] = {
            "id": "33333333-3333-4333-8333-333333333333", "preferred_name": "Person" if shape == "card" else None,
            "emails": [{"value": "person@example.com", "is_primary": True}],
            "created_at": payload["created_at"], "updated_at": payload["updated_at"],
        }
    result = model._from_dict(payload)
    if shape in ("card", "filtered"):
        assert result.contact.id == UUID(payload["contact"]["id"])
        assert result.contact.preferred_name == ("Person" if shape == "card" else None)
        assert result.contact.emails[0].value == "person@example.com"
    else:
        assert result.contact is None
