from unittest.mock import Mock

from inkbox import Inkbox, InboundEvent, InboundResource, InboundSource
from inkbox.identities.resources.identities import IdentitiesResource

SOURCE = {
    "id": "inbsrc_1", "name": "payments", "url": "https://agent.example.test/inbound/token",
    "signature": {"scheme": "hmac", "header": "x-signature", "algorithm": "sha256", "encoding": "hex", "prefix": "sha256="},
    "handler": {"type": "agent", "instructions": "Summarize the event."},
    "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
}
EVENT = {
    "id": "inbev_1", "source_id": "inbsrc_1", "received_at": "2026-01-01T00:00:00Z", "status": "failed",
    "attempts": 2, "last_error": "timeout", "signature_verified": True, "content_type": "application/json",
    "size_bytes": 2,
}
REQUEST = {"method": "POST", "query": {"a": "1"}, "headers": {"content-type": "application/json"},
           "content_type": "application/json", "body": "{}", "body_encoding": "utf8"}


def test_source_crud_and_rotate_use_identity_paths():
    http = Mock()
    http.post.return_value = http.get.return_value = http.patch.return_value = SOURCE
    inbound = InboundResource(http)
    signature = {"scheme": "stripe", "secret": "synthetic-secret"}
    source = inbound.create_source("@agent/x", name="payments", handler={"type": "script", "command": "./run.sh"}, signature=signature)
    assert isinstance(source, InboundSource) and source.signature["scheme"] == "hmac"
    http.post.assert_called_once_with("/%40agent%2Fx/inbound", json={
        "name": "payments", "signature": signature, "handler": {"type": "script", "command": "./run.sh"}})

    http.get.return_value = {"sources": [SOURCE]}
    assert inbound.list_sources("agent")[0].url == SOURCE["url"]
    http.get.assert_called_with("/agent/inbound")
    http.get.return_value = SOURCE
    assert inbound.get_source("agent", "inbsrc_1").id == "inbsrc_1"
    http.get.assert_called_with("/agent/inbound/inbsrc_1")

    inbound.update_source("agent", "inbsrc_1", name="renamed")
    http.patch.assert_called_with("/agent/inbound/inbsrc_1", json={"name": "renamed"})
    inbound.update_source("agent", "inbsrc_1", signature=None)
    http.patch.assert_called_with("/agent/inbound/inbsrc_1", json={"signature": None})

    inbound.delete_source("agent", "inbsrc_1")
    http.delete.assert_called_once_with("/agent/inbound/inbsrc_1")
    inbound.rotate_source("agent", "inbsrc_1")
    http.post.assert_called_with("/agent/inbound/inbsrc_1/rotate")


def test_null_signature_and_create_without_signature():
    http = Mock()
    http.post.return_value = SOURCE | {"signature": None}
    source = InboundResource(http).create_source("agent", name="ci", handler={"type": "agent"})
    assert source.signature is None
    assert http.post.call_args.kwargs["json"]["signature"] is None


def test_events_list_get_replay_and_result():
    http = Mock()
    inbound = InboundResource(http)
    http.get.return_value = {"events": [EVENT], "next_cursor": "next"}
    page = inbound.list_events("agent", "inbsrc_1", limit=10, cursor="c")
    assert page.next_cursor == "next" and page.events[0].request is None and page.events[0].status == "failed"
    http.get.assert_called_with("/agent/inbound/inbsrc_1/events", params={"limit": 10, "cursor": "c"})

    http.get.return_value = EVENT | {"request": REQUEST}
    event = inbound.get_event("agent", "inbsrc_1", "inbev_1")
    assert isinstance(event, InboundEvent) and event.request["body_encoding"] == "utf8"
    http.get.assert_called_with("/agent/inbound/inbsrc_1/events/inbev_1")

    http.post.return_value = EVENT | {"status": "pending"}
    assert inbound.replay_event("agent", "inbsrc_1", "inbev_1").status == "pending"
    http.post.assert_called_with("/agent/inbound/inbsrc_1/events/inbev_1/replay")

    http.post.return_value = None
    assert inbound.report_inbound_event_result("agent", "inbsrc_1", "inbev_1", status="failed", error="exit 1", delivery_id="inbdel_1") is None
    http.post.assert_called_with(
        "/agent/inbound/inbsrc_1/events/inbev_1/result",
        json={"status": "failed", "error": "exit 1", "delivery_id": "inbdel_1"},
    )


def test_client_exposes_inbound():
    with Inkbox(api_key="ak_test_example") as client:
        assert isinstance(client.inbound, InboundResource)
        assert client.inbound._http is client._ids_http


def test_hosting_exposes_agent_url():
    http = Mock()
    http.get.return_value = {"mode": "inkbox", "identity_id": "identity", "url": "https://agent.example.test",
                             "delivery": "internal"}
    hosting = IdentitiesResource(http).get_hosting("agent")
    assert (hosting.url, hosting.delivery) == ("https://agent.example.test", "internal")
    http.get.return_value = {"mode": "external", "identity_id": "identity"}
    hosting = IdentitiesResource(http).get_hosting("agent")
    assert (hosting.url, hosting.delivery) == (None, "tunnel")


def test_create_tunnel_for_existing_identity():
    http = Mock()
    http.post.return_value = {
        "id": "00000000-0000-0000-0000-000000000001", "organization_id": "org_example", "tunnel_name": "agent",
        "agent_identity_id": "00000000-0000-0000-0000-000000000000", "tls_mode": "edge", "cert_pem": None,
        "cert_fingerprint_sha256": None, "cert_expires_at": None, "status": "active", "last_connected_at": None,
        "last_connected_ip_addr": None, "last_disconnected_at": None, "currently_connected": False,
        "public_host": "agent.example.test", "zone": "example.test", "metadata": {},
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }
    tunnel = IdentitiesResource(http).create_tunnel("@agent")
    http.post.assert_called_once_with("/%40agent/tunnel", json={})
    assert (tunnel.tunnel_name, tunnel.public_host) == ("agent", "agent.example.test")


def test_hosting_ports_subresource():
    view = {
        "url": "https://agent.example.test", "default_port": 3000, "version": 4,
        "ports": [
            {"port": 3000, "public": False, "url": "https://agent.example.test",
             "token_url": "https://agent.example.test?_token=t"},
            {"port": 8080, "public": True, "url": None, "token_url": None},
        ],
    }
    http = Mock()
    http.get.return_value = http.patch.return_value = http.post.return_value = view
    resource = IdentitiesResource(http)
    ports = resource.get_hosting_ports("@agent")
    http.get.assert_called_once_with("/%40agent/hosting/ports")
    assert ports.default_port == 3000 and ports.version == 4 and ports.ports[0]["token_url"].endswith("?_token=t")
    assert ports.ports[1]["url"] is None
    options = {"version": 4, "default_port": None, "ports": [{"port": 8080, "public": True}]}
    resource.update_hosting_ports("agent", options)
    http.patch.assert_called_once_with("/agent/hosting/ports", json=options)
    assert resource.rotate_hosting_port_token("agent", 3000).url == "https://agent.example.test"
    http.post.assert_called_once_with("/agent/hosting/ports/3000/token", json={})


def test_create_hosted_identity_sends_flag():
    from sample_data_identities import IDENTITY_DETAIL_DICT
    http = Mock()
    http.post.return_value = {**IDENTITY_DETAIL_DICT, "tunnel": None}
    IdentitiesResource(http).create(agent_handle="agent", hosted=True)
    assert http.post.call_args.kwargs["json"] == {"agent_handle": "agent", "hosted": True}


def test_hosted_identity_without_tunnel_parses():
    from inkbox.agent_identity import AgentIdentity
    from inkbox.identities.types import _AgentIdentityData
    from sample_data_identities import IDENTITY_DETAIL_DICT

    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT | {"tunnel": None})
    assert data.tunnel is None
    assert AgentIdentity(data, Mock()).tunnel is None
