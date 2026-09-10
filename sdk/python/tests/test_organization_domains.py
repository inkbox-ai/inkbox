import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from inkbox import Inkbox
from inkbox.a2a.resource import A2AResource
from inkbox.domain_affiliation import parse_domain_affiliation
from inkbox.organization_domains.resource import OrganizationDomainsResource

FIXTURE = json.loads((Path(__file__).parents[3] / "tests/fixtures/domain-certification.json").read_text())


def test_claim_methods_encoding_and_unknown_state():
    http = MagicMock()
    http.post.return_value = http.get.return_value = {**FIXTURE["claim"], "state": "future_state"}
    resource = OrganizationDomainsResource(http)
    assert resource.create("example.com").state == "future_state"
    http.post.assert_called_with("/organization-domains", json={"domain": "example.com"})
    assert resource.get("claim/id").dns_record.name == "_inkbox.example.com"
    http.get.assert_called_with("/organization-domains/claim%2Fid")
    for action in ("verify", "transfer"):
        getattr(resource, action)("claim/id")
        http.post.assert_called_with(f"/organization-domains/claim%2Fid/{action}")
    resource.delete("claim/id")
    http.delete.assert_called_once_with("/organization-domains/claim%2Fid")
    http.get.return_value = {"items": [FIXTURE["claim"]], "next_cursor": "next"}
    assert resource.list(cursor="before").next_cursor == "next"
    http.get.assert_called_with("/organization-domains", params={"cursor": "before", "limit": 50})


def test_public_identity_resource_requires_explicit_publication_and_preserves_expired_selection():
    client = Inkbox(api_key="test-key")
    http = MagicMock()
    client.identities._http = http
    http.get.return_value = http.put.return_value = {
        "domain_claim_id": "claim", "domain": "example.com", "publish_publicly": False, "affiliation": None,
    }
    assert client.identities.get_domain_affiliation("@helper").domain_claim_id == "claim"
    http.get.assert_called_with("/%40helper/domain-affiliation")
    with pytest.raises(TypeError):
        client.identities.set_domain_affiliation("helper", "claim")
    client.identities.set_domain_affiliation("@helper", "claim", publish_publicly=False)
    http.put.assert_called_with("/%40helper/domain-affiliation", json={"domain_claim_id": "claim", "publish_publicly": False})
    client.identities.remove_domain_affiliation("@helper")
    http.delete.assert_called_with("/%40helper/domain-affiliation")


def test_filtered_iterator_preserves_filter_and_raw_card_extension():
    http = MagicMock()
    item = {"card_url": "https://inkbox.ai/a2a/helper/card", "visibility": "public", "card": {
        "name": "@helper", "capabilities": {"extensions": [{
            "uri": "https://inkbox.ai/a2a/extensions/domain-affiliation/v1", "params": FIXTURE["affiliation"],
        }]},
    }}
    http.get.side_effect = [{"items": [item], "next_cursor": "next"}, {"items": [item], "next_cursor": None}]
    items = list(A2AResource(MagicMock(), http).iter_public_directory(q="help", verified_domain="example.com"))
    assert len(items) == 2
    assert all(call.kwargs["params"]["verified_domain"] == "example.com" for call in http.get.call_args_list)
    assert http.get.call_args_list[1].kwargs["params"]["cursor"] == "next"
    assert parse_domain_affiliation(None) is None
    assert parse_domain_affiliation(FIXTURE["affiliation"]).domain == "example.com"
