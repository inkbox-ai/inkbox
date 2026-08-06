import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from inkbox.a2a.invitations import (
    A2AInvitationParseError,
    A2AInvitationsResource,
    extract_a2a_invitation_token,
)


RAW = {
    "id": "inv_1",
    "issuer_organization_id": "org_1",
    "peer_agent_handles": ["support"],
    "recipient_email": None,
    "status": "pending",
    "email_status": "not_requested",
    "email_sent_at": None,
    "invitee_identity_id": None,
    "invitee_agent_handle": None,
    "invitee_organization_id": None,
    "expires_at": "2026-08-11T00:00:00Z",
    "accepted_at": None,
    "declined_at": None,
    "revoked_at": None,
    "created_at": "2026-08-04T00:00:00Z",
    "updated_at": "2026-08-04T00:00:00Z",
}


def test_create_preserves_one_time_unbound_secret() -> None:
    http = MagicMock()
    http.post.return_value = {
        **RAW,
        "invitation_token": "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "invitation_url": "https://inkbox.ai/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "agent_handoff_prompt": "Ask your agent to accept this invitation.",
    }
    result = A2AInvitationsResource(http).create(["support"], expires_in_seconds=7200)
    http.post.assert_called_once_with(
        "/a2a/invitations",
        json={"peer_agent_handles": ["support"], "expires_in_seconds": 7200},
    )
    assert result.invitation_token == "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    assert result.invitation_url == (
        "https://inkbox.ai/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    )
    assert result.peer_agent_handles == ["support"]


def test_bound_create_normalizes_omitted_secrets() -> None:
    http = MagicMock()
    http.post.return_value = {**RAW, "recipient_email": "person@example.test"}
    result = A2AInvitationsResource(http).create(
        ["support"], recipient_email="person@example.test"
    )
    assert result.invitation_token is None
    assert result.invitation_url is None
    assert result.agent_handoff_prompt is None


def test_list_get_revoke_and_accept_use_canonical_routes() -> None:
    http = MagicMock()
    resource = A2AInvitationsResource(http)
    http.get.side_effect = [{"items": [RAW], "next_cursor": "next"}, RAW]
    page = resource.list(status="pending", cursor="cursor", limit=10)
    assert page.next_cursor == "next"
    resource.get("inv_1")
    assert http.get.call_args_list[0].args == ("/a2a/invitations",)
    assert http.get.call_args_list[1].args == ("/a2a/invitations/inv_1",)

    http.post.side_effect = [
        {**RAW, "status": "revoked", "revoked_at": "2026-08-04T01:00:00Z"},
        {
            "invitation_id": "inv_1",
            "status": "accepted",
            "invitee_identity_id": "identity_2",
            "invitee_agent_handle": "buyer",
            "peer_agent_handles": ["support"],
            "accepted_at": "2026-08-04T02:00:00Z",
        },
    ]
    resource.revoke("inv_1")
    accepted = resource.accept("a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
    assert http.post.call_args_list[0].args == ("/a2a/invitations/inv_1/revoke",)
    assert http.post.call_args_list[1].kwargs["json"] == {
        "invitation_token": "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }
    assert accepted.invitee_agent_handle == "buyer"


def test_accept_extracts_url_token_before_transport() -> None:
    http = MagicMock()
    http.post.return_value = {
        "invitation_id": "inv_1",
        "status": "accepted",
        "invitee_identity_id": "identity_2",
        "invitee_agent_handle": "buyer",
        "peer_agent_handles": ["support"],
        "accepted_at": "2026-08-04T02:00:00Z",
    }
    resource = A2AInvitationsResource(http, "https://beta.inkbox.ai")
    resource.accept(
        "https://beta.inkbox.ai/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    )
    assert http.post.call_args.kwargs["json"] == {
        "invitation_token": "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }


def test_shared_invitation_input_vectors() -> None:
    fixture = Path(__file__).parents[3] / "tests/fixtures/a2a_invitation_inputs.json"
    vectors = json.loads(fixture.read_text())
    for case in vectors["valid"]:
        assert (
            extract_a2a_invitation_token(case["input"], base_url=case["base_url"])
            == case["token"]
        )
    for case in vectors["invalid"]:
        with pytest.raises(A2AInvitationParseError) as caught:
            extract_a2a_invitation_token(case["input"], base_url=case["base_url"])
        assert "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" not in str(
            caught.value
        )


def test_create_does_not_invent_a_share_url_for_an_old_server() -> None:
    http = MagicMock()
    http.post.return_value = {
        **RAW,
        "invitation_token": "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    }
    result = A2AInvitationsResource(http).create(["support"])
    assert result.invitation_url is None


def test_rejects_oversized_invitation_input() -> None:
    with pytest.raises(A2AInvitationParseError):
        extract_a2a_invitation_token("x" * 2049)
