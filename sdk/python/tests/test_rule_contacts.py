from uuid import UUID

import pytest

from inkbox.imessage.types import IMessageContactRule
from inkbox.mail.types import MailIdentityContactRule
from inkbox.phone.types import PhoneIdentityContactRule


@pytest.mark.parametrize("model", [MailIdentityContactRule, PhoneIdentityContactRule, IMessageContactRule])
@pytest.mark.parametrize("shape", ["absent", "null", "card"])
def test_rule_contact_parsing(model, shape):
    payload = {
        "id": "11111111-1111-4111-8111-111111111111",
        "agent_identity_id": "22222222-2222-4222-8222-222222222222",
        "action": "allow", "status": "active",
        "match_type": "exact_email" if model is MailIdentityContactRule else "exact_number",
        "match_target": "person@example.com" if model is MailIdentityContactRule else "+14155550123",
        "created_at": "2026-09-05T00:00:00Z", "updated_at": "2026-09-05T00:00:00Z",
    }
    if shape != "absent":
        payload["contact"] = None
    if shape == "card":
        payload["contact"] = {
            "id": "33333333-3333-4333-8333-333333333333", "preferred_name": "Person",
            "emails": [{"value": "person@example.com", "is_primary": True}],
            "created_at": payload["created_at"], "updated_at": payload["updated_at"],
        }
    result = model._from_dict(payload)
    if shape == "card":
        assert result.contact.id == UUID(payload["contact"]["id"])
        assert result.contact.preferred_name == "Person"
        assert result.contact.emails[0].value == "person@example.com"
        assert result.contact.created_at.year == 2026
    else:
        assert result.contact is None
