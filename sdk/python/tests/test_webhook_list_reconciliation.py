"""Legacy single-family reconciliation must not replace mixed subscriptions."""

from copy import deepcopy
from unittest.mock import MagicMock

import pytest

from inkbox.webhook_subscriptions import WebhookSubscriptionsResource

IDENTITY = "11111111-1111-4111-8111-111111111111"
ROW = {
    "id": "22222222-2222-4222-8222-222222222222",
    "organization_id": "org_example",
    "agent_identity_id": IDENTITY,
    "mailbox_id": None,
    "phone_number_id": None,
    "url": "https://example.com/webhook",
    "event_types": ["imessage.received", "message.sent"],
    "status": "active",
    "created_at": "2026-09-01T00:00:00Z",
    "updated_at": "2026-09-01T00:00:00Z",
}


@pytest.mark.parametrize("replacement", ["patch", "delete_create"])
@pytest.mark.parametrize("mixed", [True, False])
def test_legacy_reconciler_does_not_modify_mixed_or_separate_rows(replacement, mixed):
    stored = deepcopy(ROW)
    if not mixed:
        stored["event_types"] = ["imessage.received"]
    mail = {**deepcopy(ROW), "id": "33333333-3333-4333-8333-333333333333",
            "event_types": ["message.sent"]}
    rows = [stored] if mixed else [stored, mail]
    before = deepcopy(rows)
    http = MagicMock()

    def list_rows(path, *, params=None):
        if path == "/webhooks/catalog":
            return {"supports_identity_subscriptions": True}
        assert path == "/webhooks/subscriptions"
        selected = rows if params.get("scope") == "identity" else [
            row for row in rows if all(
                event.startswith("imessage.") for event in row["event_types"]
            )
        ]
        return {"subscriptions": deepcopy(selected)}

    def create_row(path, *, json):
        assert any(set(json["event_types"]) & set(row["event_types"]) for row in rows)
        # The existing mixed receiver is reused without replacing its events.
        return deepcopy(stored)

    http.get.side_effect = list_rows
    http.post.side_effect = create_row
    resource = WebhookSubscriptionsResource(http)

    def reconcile():
        desired = ["imessage.received"]
        for row in resource.list(agent_identity_id=IDENTITY):
            if row.url != ROW["url"]:
                continue
            if row.event_types == desired:
                return
            if "imessage.received" in row.event_types:
                if replacement == "patch":
                    resource.update(row.id, event_types=desired)
                    return
                resource.delete(row.id)
        resource.create(agent_identity_id=IDENTITY, url=ROW["url"], event_types=desired)

    reconcile()
    if mixed:
        http.post.assert_called_once()
    else:
        http.post.assert_not_called()
    http.patch.assert_not_called()
    http.delete.assert_not_called()
    assert rows == before
    # An explicit identity-wide reader can still inspect every original row.
    assert len(resource.list(agent_identity_id=IDENTITY, scope="identity")) == len(rows)
