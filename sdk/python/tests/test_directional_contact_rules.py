"""Directional rules preserve legacy requests and positional constructors."""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import pytest

from inkbox import (
    AgentIdentitySummary, ContactAddressUpdate, ContactChannelAccess,
    ContactChannelAccessUpdate, ContactCreatePermissions, ContactRuleDirection,
    FilterMode, Inkbox, Mailbox, MailContactRule, MailIdentityContactRule,
    PhoneContactRule, PhoneIdentityContactRule, IMessageContactRule,
)
from inkbox.contacts.resources.communication_policy import ContactAddressPermission, ContactCommunicationPreview

ID = "11111111-1111-4111-8111-111111111111"
NOW = "2026-09-01T00:00:00Z"
IDENTITY = {
    "id": ID, "organization_id": "example-org", "agent_handle": "test-agent",
    "created_at": NOW, "updated_at": NOW, "mail_filter_mode": "whitelist",
    "phone_filter_mode": "whitelist", "imessage_filter_mode": "whitelist",
}
RULE = {
    "id": ID, "mailbox_id": ID, "phone_number_id": ID, "agent_identity_id": ID,
    "action": "allow", "match_type": "exact_number", "match_target": "+15555550123",
    "status": "active", "created_at": NOW, "updated_at": NOW,
}


def test_legacy_preview_visibility_does_not_imply_communication_permission():
    preview = ContactCommunicationPreview._from_dict({
        "identity_id": ID, "contact": None, "email": True, "phone": True,
        "full_profile": True, "visibility": {"profile": True, "memories": True},
    })
    assert preview.email and preview.phone
    assert preview.inbound_email is None and preview.outbound_email is None
    assert preview.inbound_phone is None and preview.outbound_phone is None


@pytest.mark.parametrize("resource_name,owner,mail", [
    ("mail_contact_rules", "agent@example.com", True),
    ("mail_identity_contact_rules", "test-agent", True),
    ("phone_contact_rules", ID, False),
    ("phone_identity_contact_rules", "test-agent", False),
    ("imessage_contact_rules", "test-agent", False),
])
def test_rule_wire_compatibility_and_directional_crud(resource_name, owner, mail):
    requests = []
    rule = {**RULE, **({"match_type": "exact_email", "match_target": "x@example.com"} if mail else {})}

    def respond(request):
        body = json.loads(request.content) if request.content else None
        requests.append((request, body))
        row = {**rule, **(body or {})}
        if request.method == "GET":
            return httpx.Response(200, json=[row])
        return httpx.Response(201 if request.method == "POST" else 200, json=row)

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox("test-key", base_url="https://example.com")
    with client:
        resource = getattr(client, resource_name)
        options = {key: rule[key] for key in ("action", "match_type", "match_target")}
        old = resource.create(owner, **options)
        assert old.direction is ContactRuleDirection.BOTH
        assert requests[-1][1] == options
        saved = resource.create(owner, **options, direction=ContactRuleDirection.OUTBOUND)
        assert saved.id == old.id
        assert saved.direction is ContactRuleDirection.OUTBOUND
        assert requests[-1][1] == {**options, "direction": "outbound"}
        resource.update(owner, ID, action="block")
        assert requests[-1][1] == {"action": "block"}
        resource.update(owner, ID, direction="inbound")
        assert requests[-1][1] == {"direction": "inbound"}
        resource.update(owner, ID, action="block", apply_to="inbound")
        assert requests[-1][1] == {"action": "block", "apply_to": "inbound"}
        resource.list(owner, direction="outbound", action="allow", limit=2, offset=1)
        assert dict(requests[-1][0].url.params) == {
            "direction": "outbound", "action": "allow", "limit": "2", "offset": "1",
        }
        resource.list_all(direction="both")
        assert dict(requests[-1][0].url.params) == {"direction": "both"}
        resource.list_all()
        assert not requests[-1][0].url.params
        count = len(requests)
        for kwargs in ({}, {"direction": None}, {"apply_to": "inbound"},
                       {"action": "allow", "apply_to": None},
                       {"action": "allow", "apply_to": "both"},
                       {"action": "allow", "direction": "both", "apply_to": "outbound"}):
            with pytest.raises(ValueError):
                resource.update(owner, ID, **kwargs)
        assert len(requests) == count


@pytest.mark.parametrize("model,mail,has_contact", [
    (MailContactRule, True, False), (MailIdentityContactRule, True, True),
    (PhoneContactRule, False, False), (PhoneIdentityContactRule, False, True),
    (IMessageContactRule, False, True),
])
def test_old_rule_positional_constructors(model, mail, has_contact):
    now = datetime.now(timezone.utc)
    args = [UUID(ID), UUID(ID), "allow", "exact_email" if mail else "exact_number",
            "x@example.com" if mail else "+15555550123", "active", now, now]
    if has_contact:
        args.append(None)
    assert model(*args).direction == ContactRuleDirection.BOTH


def test_identity_modes_and_convenience_methods_preserve_omission():
    requests = []

    def respond(request):
        body = json.loads(request.content) if request.content else None
        requests.append((request, body))
        if "contact-rules" in request.url.path:
            row = {**RULE, **(body or {})}
            if "mail-contact-rules" in request.url.path:
                row["match_type"] = "exact_email"
            return httpx.Response(200, json=[row] if request.method == "GET" else row)
        return httpx.Response(200, json={**IDENTITY, **(body or {})})

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox("test-key", base_url="https://example.com")
    with client:
        identity = client.get_identity("test-agent")
        assert identity.mail_inbound_filter_mode == FilterMode.WHITELIST
        assert identity.phone_outbound_filter_mode == FilterMode.WHITELIST
        identity.update(display_name="Example")
        assert requests[-1][1] == {"display_name": "Example"}
        identity.update(mail_inbound_filter_mode="blacklist")
        assert requests[-1][1] == {"mail_inbound_filter_mode": "blacklist"}
        assert identity.mail_inbound_filter_mode == "blacklist"
        assert identity.mail_outbound_filter_mode == "whitelist"
        identity.update(mail_filter_mode="blacklist", phone_outbound_filter_mode="whitelist")
        assert requests[-1][1] == {"mail_filter_mode": "blacklist", "phone_outbound_filter_mode": "whitelist"}
        identity.update(phone_filter_mode="whitelist", imessage_filter_mode="whitelist")
        count = len(requests)
        for kwargs in (
            {"mail_filter_mode": "whitelist", "mail_inbound_filter_mode": "blacklist"},
            {"imessage_filter_mode": "whitelist", "phone_outbound_filter_mode": "blacklist"},
            {"phone_filter_mode": "blacklist", "imessage_filter_mode": "whitelist"},
            {"phone_inbound_filter_mode": None},
        ):
            with pytest.raises(ValueError):
                identity.update(**kwargs)
        assert len(requests) == count
        identity.create_mail_contact_rule(action="allow", match_type="exact_email", match_target="x@example.com", direction="inbound")
        assert requests[-1][1]["direction"] == "inbound"
        identity.update_mail_contact_rule(ID, direction="both")
        assert requests[-1][1] == {"direction": "both"}
        identity.update_phone_contact_rule(ID, action="block", apply_to="outbound")
        assert requests[-1][1] == {"action": "block", "apply_to": "outbound"}
        identity.list_phone_contact_rules(direction="inbound")
        assert requests[-1][0].url.params["direction"] == "inbound"


def test_effective_mode_fallbacks_and_shared_projection():
    summary = AgentIdentitySummary._from_dict(IDENTITY)
    assert summary.mail_outbound_filter_mode == summary.phone_inbound_filter_mode == "whitelist"
    common = AgentIdentitySummary._from_dict({**IDENTITY, "mail_filter_mode": "blacklist",
        "mail_inbound_filter_mode": "whitelist", "mail_outbound_filter_mode": "whitelist"})
    assert common.mail_filter_mode == "whitelist"
    mailbox = Mailbox._from_dict({"id": ID, "email_address": "x@example.com",
        "filter_mode": "whitelist", "created_at": NOW, "updated_at": NOW})
    assert mailbox.inbound_filter_mode == mailbox.outbound_filter_mode == "whitelist"
    old = Mailbox(UUID(ID), "x@example.com", FilterMode.WHITELIST, datetime.now(), datetime.now())
    assert old.inbound_filter_mode == "whitelist"


def test_directional_access_creation_and_legacy_outbound_projection():
    response = {
        "email": {"visible": True, "contactable": [], "inbound_contactable": ["x@example.com"], "outbound_contactable": []},
        "phone": {"visible": False, "contactable": []}, "profile": True, "memories": False,
    }
    http = MagicMock()
    http.patch.return_value = response
    from inkbox.contacts.resources.contacts import ContactsResource
    contacts = ContactsResource(http)
    result = contacts.access.update("test-agent", ID,
        email=ContactChannelAccessUpdate(inbound_contactable=["x@example.com"]))
    assert http.patch.call_args.kwargs["json"] == {"email": {"inbound_contactable": ["x@example.com"]}}
    assert result.email.contactable == result.email.outbound_contactable == []
    assert result.email.inbound_contactable == ["x@example.com"]
    assert ContactChannelAccess(True, ["x@example.com"]).inbound_contactable == ["x@example.com"]
    assert ContactChannelAccessUpdate(True, []).to_wire() == {"visible": True, "contactable": []}
    permissions = ContactCreatePermissions(ID, email=ContactChannelAccessUpdate(outbound_contactable=[]))
    assert permissions.to_wire() == {"identity_id": ID, "email": {"outbound_contactable": []}}
    http.post.return_value = {"id": ID, "created_at": NOW, "updated_at": NOW}
    contacts.create(permissions=permissions)
    assert http.post.call_args.kwargs["json"] == {"permissions": permissions.to_wire()}
    for kwargs in ({"contactable": None}, {"inbound_contactable": None}, {"outbound_contactable": None},
                   {"contactable": [], "inbound_contactable": []},
                   {"visible": False, "inbound_contactable": ["x@example.com"]}):
        with pytest.raises(ValueError):
            ContactChannelAccessUpdate(**kwargs).to_wire()
    with pytest.raises(ValueError, match="Profile"):
        ContactCreatePermissions(ID, profile=False,
            email=ContactChannelAccessUpdate(inbound_contactable=["x@example.com"])).to_wire()


def test_address_edits_preserve_old_wire_and_directional_expectations():
    old = ContactAddressUpdate("email", "x@example.com", "allow", "block")
    assert old.to_wire() == {"kind": "email", "value": "x@example.com", "action": "allow", "expected_action": "block"}
    new = ContactAddressUpdate("email", "x@example.com", "allow", "block", "both", "block", "allow")
    assert new.to_wire() == {**old.to_wire(), "direction": "both", "expected_inbound_action": "block", "expected_outbound_action": "allow"}
    pair = ContactAddressUpdate("email", "x@example.com", "allow", direction="both",
                                expected_inbound_action="block", expected_outbound_action="allow")
    assert pair.to_wire() == {key: value for key, value in new.to_wire().items() if key != "expected_action"}
    permission = ContactAddressPermission._from_dict({"kind": "email", "value": "x@example.com", "label": None,
        "action": "block", "allowed": False, "inbound_action": "allow", "outbound_action": "block",
        "allowed_inbound": True, "allowed_outbound": False})
    assert permission.allowed_inbound and not permission.allowed_outbound and not permission.allowed


def test_directional_boolean_permissions_keep_outbound_legacy_projection():
    from inkbox.contacts.resources.permissions import ContactPermissions, ContactPermissionsResource
    http = MagicMock()
    http.patch.return_value = {
        "emails": {"x@example.com": False}, "phones": {}, "profile": True, "memories": False,
        "inbound_emails": {"x@example.com": True}, "outbound_emails": {"x@example.com": False},
        "inbound_phones": {}, "outbound_phones": {},
    }
    resource = ContactPermissionsResource(http)
    result = resource.update("test-agent", ID, inbound_emails={"x@example.com": True})
    assert result.inbound_emails == {"x@example.com": True}
    assert result.emails == result.outbound_emails == {"x@example.com": False}
    assert http.patch.call_args.kwargs["json"] == {"inbound_emails": {"x@example.com": True}}
    assert ContactPermissions({"x@example.com": True}, {}, True, False).inbound_emails == {"x@example.com": True}
    for kwargs in ({"inbound_emails": None}, {"emails": {}, "outbound_emails": {}},
                   {"profile": False, "inbound_emails": {"x@example.com": True}}):
        with pytest.raises(ValueError):
            resource.update("test-agent", ID, **kwargs)


@pytest.mark.parametrize("direction", [ContactRuleDirection.INBOUND, ContactRuleDirection.OUTBOUND])
def test_address_edit_accepts_only_the_covered_side_guard_through_replace(direction):
    from inkbox.contacts.resources.communication_policy import ContactCommunicationPolicyResource

    http = MagicMock()
    http.put.return_value = {
        "contact_id": ID, "revision": 2, "identity_id": ID, "addresses": [],
        "effective_visibility": None,
        "visibility": {"defaults": {"profile": "inherit", "memories": "inherit"}, "identities": []},
    }
    guard = f"expected_{direction}_action"
    edit = ContactAddressUpdate("email", "x@example.com", "allow", direction=direction, **{guard: "block"})
    result = ContactCommunicationPolicyResource(http).replace(
        ID, expected_revision=1, identity_id=ID, addresses=[edit],
    )
    assert result.revision == 2
    assert http.put.call_args.kwargs["json"]["addresses"] == [{
        "kind": "email", "value": "x@example.com", "action": "allow",
        "direction": direction.value, guard: "block",
    }]


@pytest.mark.parametrize("options", [
    {"direction": "inbound"},
    {"direction": "inbound", "expected_outbound_action": "block"},
    {"direction": "outbound", "expected_inbound_action": "block"},
    {"direction": "both", "expected_inbound_action": "block"},
    {"direction": "both", "expected_outbound_action": "block"},
    {"expected_inbound_action": "block"},
    {"expected_outbound_action": "block"},
    {"direction": "inbound", "expected_inbound_action": None},
])
def test_address_edit_rejects_missing_or_null_covered_side_guards(options):
    with pytest.raises(ValueError):
        ContactAddressUpdate("email", "x@example.com", "allow", **options).to_wire()


@pytest.mark.parametrize("options", [{}, {"direction": "inbound"}, {"direction": "outbound"}, {"direction": "both"}])
def test_legacy_expected_action_remains_valid_for_every_direction(options):
    edit = ContactAddressUpdate("email", "x@example.com", "allow", "block", **options)
    assert edit.to_wire() == {
        "kind": "email", "value": "x@example.com", "action": "allow",
        "expected_action": "block", **options,
    }


def test_omitted_direction_accepts_both_guards_without_adding_wire_direction():
    edit = ContactAddressUpdate("email", "x@example.com", "allow",
                                expected_inbound_action="block", expected_outbound_action="inherit")
    assert edit.to_wire() == {
        "kind": "email", "value": "x@example.com", "action": "allow",
        "expected_inbound_action": "block", "expected_outbound_action": "inherit",
    }


def test_initial_access_preserves_two_directions_for_fifty_emails_and_fifty_phones():
    from inkbox import ContactEmail, ContactPhone

    emails = [f"person{index}@example.com" for index in range(50)]
    phones = [f"+1555555{index:04d}" for index in range(50)]
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(201, json={"id": ID, "created_at": NOW, "updated_at": NOW})

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox("test-key", base_url="https://example.com")
    with client:
        client.contacts.create(
            emails=[ContactEmail(None, value) for value in emails],
            phones=[ContactPhone(None, value) for value in phones],
            permissions=ContactCreatePermissions(
                ID, profile=True,
                email=ContactChannelAccessUpdate(inbound_contactable=emails, outbound_contactable=emails),
                phone=ContactChannelAccessUpdate(inbound_contactable=phones, outbound_contactable=phones),
            ),
        )
    assert len(requests) == 1
    assert requests[0].url.path == "/api/v1/contacts/with-permissions"
    body = json.loads(requests[0].content)
    assert len(body["emails"]) == len(body["phones"]) == 50
    assert body["permissions"] == {
        "identity_id": ID, "profile": True,
        "email": {"inbound_contactable": emails, "outbound_contactable": emails},
        "phone": {"inbound_contactable": phones, "outbound_contactable": phones},
    }
    assert sum(len(values) for group in ("email", "phone")
               for values in body["permissions"][group].values()) == 200
