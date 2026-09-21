"""Response metadata is advisory, isolated, and independent of result shape."""

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from threading import Barrier
from unittest.mock import patch

import httpx
import pytest

from inkbox import APIResponse, Inkbox, ResponseMetadata, ResponseNotice
from inkbox._http import HttpTransport
from inkbox.exceptions import DuplicateContactRuleError, InkboxAPIError
from inkbox.vault.resources.vault import UnlockedVault

ID = "11111111-1111-4111-8111-111111111111"
NOTICE = {"code": "future_notice", "level": "future_level", "message": "Additional information."}


def make_client(respond, observer=None):
    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        return Inkbox("test-key", base_url="https://example.com", response_observer=observer)


@pytest.mark.parametrize("kind", ["object", "list", "scalar", "binary", "empty", "raw"])
def test_metadata_preserves_all_transport_shapes(kind):
    observed = []
    calls = []

    def respond(request):
        calls.append(request)
        headers = {"Inkbox-Notices": json.dumps([NOTICE])}
        if kind == "empty":
            return httpx.Response(204, headers=headers)
        if kind in ("binary", "raw"):
            return httpx.Response(200, content=b"\x00\xff", headers=headers)
        return httpx.Response(200, json={"object": {"value": 1}, "list": [1], "scalar": 1}[kind], headers=headers)

    def operation(client):
        http = client._api_http
        if kind == "empty":
            return http.delete("/example")
        if kind == "binary":
            return http.get_bytes("/example", accept="application/octet-stream")
        if kind == "raw":
            return http.get_raw("/example", accept="application/octet-stream")
        return http.get("/example")

    with make_client(respond, observed.append) as client:
        original = operation(client)
        response = client.with_response_metadata(operation)
        assert isinstance(response, APIResponse)
        if kind == "raw":
            assert response.data.content == original.content == b"\x00\xff"
            assert "Inkbox-Notices" in response.data.headers
        else:
            assert response.data == original
        assert response.notices == [ResponseNotice(**NOTICE)]
        assert observed == [ResponseMetadata(response.notices)] * 2
        assert len(calls) == 2
        if kind == "empty":
            assert asdict(response)["data"] is None


@pytest.mark.parametrize("header,body,expected", [
    (None, [NOTICE], [NOTICE]),
    ("broken", [NOTICE], [NOTICE]),
    (json.dumps([NOTICE, {"code": 3}, None, {**NOTICE, "extra": True}]), [], [NOTICE]),
    (json.dumps([NOTICE]), [{**NOTICE, "code": "body"}], [NOTICE]),
    ("null", [NOTICE], None), ("[]", [NOTICE], None),
    (None, None, None), (None, [], None), ("{}", [NOTICE], [NOTICE]),
])
def test_header_precedence_and_declared_body_fallback(header, body, expected):
    def respond(request):
        return httpx.Response(200, json={"notices": body},
                              headers={"Inkbox-Notices": header} if header is not None else {})
    with make_client(respond) as client:
        result = client.with_response_metadata(lambda scoped: scoped._api_http.get(f"/identities/test-agent/contacts/{ID}/access"))
    assert result.notices == ([ResponseNotice(**item) for item in expected] if expected else None)


@pytest.mark.parametrize("path,payload", [
    ("/notes/example", {"notices": [NOTICE]}),
    ("/contacts/example", {"notes": {"notices": [NOTICE]}}),
    ("/identities/test-agent", {"mailbox": {"notices": [NOTICE]}}),
    ("/identities/test-agent", [{"notices": [NOTICE]}]),
])
def test_user_content_is_never_interpreted_as_notices(path, payload):
    with make_client(lambda _: httpx.Response(200, json=payload)) as client:
        result = client.with_response_metadata(lambda scoped: scoped._api_http.get(path))
    assert result.notices is None
    assert result.data == payload


@pytest.mark.parametrize("status,detail,error", [
    (409, {"existing_rule_id": ID}, DuplicateContactRuleError),
    (422, "Invalid request", InkboxAPIError),
])
def test_errors_are_observed_before_unchanged_exception(status, detail, error):
    observed = []
    def respond(_):
        return httpx.Response(status, json={"detail": detail, "agent_support": "Keep this guidance."},
                              headers={"Inkbox-Notices": json.dumps([NOTICE])})
    with make_client(respond, observed.append) as client:
        with pytest.raises(error) as caught:
            client.with_response_metadata(lambda scoped: scoped._api_http.post("/example", json={}))
    assert observed == [ResponseMetadata([ResponseNotice(**NOTICE)])]
    assert caught.value.status_code == status
    assert caught.value.agent_support == "Keep this guidance."


def test_decoder_and_observer_failures_do_not_retry_successful_writes():
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(201, json={"saved": True}, headers={"Inkbox-Notices": json.dumps([NOTICE])})
    def broken(_):
        raise RuntimeError("Observer failure")
    with make_client(respond, broken) as client:
        result = client.with_response_metadata(lambda scoped: scoped._api_http.post("/example", json={}))
        assert result.data == {"saved": True}
        assert result.notices == [ResponseNotice(**NOTICE)]
        with patch("inkbox.response_metadata._response_metadata", side_effect=ValueError):
            assert client._api_http.post("/example", json={}) == {"saved": True}
    assert len(calls) == 2


def test_concurrent_nested_and_parent_operations_are_isolated():
    barrier = Barrier(2)
    observed = []
    def respond(request):
        name = request.url.path.rsplit("/", 1)[-1]
        if name in ("left", "right"):
            barrier.wait(timeout=5)
        return httpx.Response(200, json=name, headers={"Inkbox-Notices": json.dumps([{**NOTICE, "code": name}])})
    with make_client(respond, observed.append) as client:
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(client.with_response_metadata,
                lambda scoped, name=name: scoped._api_http.get(f"/{name}")) for name in ("left", "right")]
            results = [future.result() for future in futures]
        assert [[notice.code for notice in result.notices] for result in results] == [["left"], ["right"]]
        def outer(scoped):
            scoped._api_http.get("/outer")
            inner = scoped.with_response_metadata(lambda nested: nested._api_http.get("/inner"))
            assert [notice.code for notice in inner.notices] == ["inner"]
            client._api_http.get("/parent")
            scoped._api_http.get("/outer")
            return inner.data
        result = client.with_response_metadata(outer)
        assert result.data == "inner"
        assert [notice.code for notice in result.notices] == ["outer"]
        assert len(observed) == 6


def test_scopes_share_connections_auth_cookies_and_vault_without_reunlock():
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=[], headers={"Set-Cookie": "session=example; Path=/; Secure",
                                                    "Inkbox-Notices": json.dumps([NOTICE])})
    with make_client(respond) as client:
        client.vault._unlocked = UnlockedVault(client._vault_http, b"example-key", [])
        parent_unlocked = client.vault.unlocked
        def scoped_operation(scoped):
            assert scoped._api_http._client is client._api_http._client
            assert scoped.vault.unlocked is scoped.vault.unlocked
            assert scoped.vault.unlocked._org_key is parent_unlocked._org_key
            assert scoped.vault.unlocked._secrets_cache is parent_unlocked._secrets_cache
            scoped.vault.unlocked._http.get("/secrets")
            scoped.close()
            return scoped.contacts.list()
        with patch.object(client.vault, "unlock", side_effect=AssertionError("Unexpected unlock")):
            result = client.with_response_metadata(scoped_operation)
        assert result.data == [] and result.notices == [ResponseNotice(**NOTICE)]
        assert len(requests) == 2
        assert requests[1].headers["Cookie"] == "session=example"
        assert requests[1].headers["X-API-Key"] == "test-key"
        assert not client._api_http._client.is_closed


def test_identity_bound_resource_and_all_subtransports_observe_responses():
    observed = []
    def respond(request):
        if request.url.path == "/api/v1/identities/test-agent":
            data = {"id": ID, "organization_id": "example-org", "agent_handle": "test-agent",
                    "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z"}
        else:
            data = []
        return httpx.Response(200, json=data, headers={"Inkbox-Notices": json.dumps([NOTICE])})
    with make_client(respond, observed.append) as client:
        result = client.with_response_metadata(lambda scoped: scoped.get_identity("test-agent").list_phone_contact_rules())
        assert result.data == [] and result.notices == [ResponseNotice(**NOTICE)]
        for transport in client.__dict__.values():
            if isinstance(transport, HttpTransport):
                transport.get("/example")
        assert len(observed) == 12


def test_completed_scope_metadata_cannot_change_through_returned_client():
    def respond(request):
        return httpx.Response(200, json=[], headers={"Inkbox-Notices": json.dumps([
            {**NOTICE, "code": request.url.path.rsplit("/", 1)[-1]},
        ])})
    with make_client(respond) as client:
        def operation(scoped):
            scoped._api_http.get("/first")
            return scoped
        result = client.with_response_metadata(operation)
        result.data._api_http.get("/later")
        assert [notice.code for notice in result.notices] == ["first"]


def test_scoped_vault_refresh_and_reunlock_state_are_shared():
    with make_client(lambda _: httpx.Response(204)) as client:
        first = UnlockedVault(client._vault_http, b"first-example", [])
        client.vault._unlocked = first
        def operation(scoped):
            view = scoped.vault.unlocked
            replacement = UnlockedVault(scoped._vault_http, b"second-example", [])
            scoped.vault._unlocked = replacement
            assert client.vault.unlocked._org_key == b"second-example"
            assert scoped.vault.unlocked is not view
            assert scoped.vault.unlocked._http is scoped._vault_http
            assert client.vault.unlocked._http is client._vault_http
        client.with_response_metadata(operation)


def test_standalone_requests_and_a2a_observe_headers_without_protocol_injection():
    from inkbox import A2AClient, A2AProtocolError
    from inkbox.a2a.types import A2ACard, A2AResolvedTarget
    observed = []
    def respond(request):
        return httpx.Response(200, json={"error": {"code": -32600, "message": "Invalid request"},
                                        "notices": [{**NOTICE, "code": "body-content"}]},
                              headers={"Inkbox-Notices": json.dumps([NOTICE])})
    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        Inkbox._one_shot_request("GET", "/api/v1/agent-signup/status", base_url="https://example.com", response_observer=observed.append)
        with A2AClient(api_key="test-key", platform_base_url="https://example.com", response_observer=observed.append) as client:
            target = A2AResolvedTarget("https://example.com/card", "https://example.com/rpc", "1.0", A2ACard({}), None)
            with pytest.raises(A2AProtocolError):
                client.send(target, text="Example")
    assert observed == [ResponseMetadata([ResponseNotice(**NOTICE)])] * 2


@pytest.mark.parametrize("suffix", ["", "/"])
@pytest.mark.parametrize("header,body_notices,expected", [
    (None, [NOTICE], [NOTICE]),
    ("broken", [NOTICE], [NOTICE]),
    (json.dumps([{**NOTICE, "code": "header"}]), [NOTICE], [{**NOTICE, "code": "header"}]),
    ("[]", [NOTICE], None),
    ("null", [NOTICE], None),
    (None, [None, {"code": 3}, NOTICE], [NOTICE]),
    ("broken", {"message": "Not a notice list"}, None),
    (None, None, None),
])
def test_avatar_put_declares_body_notices_with_header_precedence(suffix, header, body_notices, expected):
    observed = []
    body = {
        "id": ID, "agent_handle": "test-agent", "organization_id": "example-org",
        "created_at": "2026-09-01T00:00:00Z", "updated_at": "2026-09-01T00:00:00Z",
        "notices": body_notices,
    }
    requests = []

    def respond(request):
        requests.append(request)
        assert request.method == "PUT"
        return httpx.Response(200, json=body,
                              headers={"Inkbox-Notices": header} if header is not None else {})

    with make_client(respond, observed.append) as client:
        result = client.with_response_metadata(
            lambda scoped: scoped._ids_http.put(f"/test-agent/avatar{suffix}", json={}),
        )
    notices = [ResponseNotice(**item) for item in expected] if expected else None
    assert result.data == body
    assert result.notices == notices
    assert observed == [ResponseMetadata(notices)]
    assert len(requests) == 1


@pytest.mark.parametrize("suffix", ["", "/"])
@pytest.mark.parametrize("header", [None, "broken", json.dumps([NOTICE])])
def test_avatar_get_never_scans_downloaded_bytes_for_body_notices(suffix, header):
    content = json.dumps({"notices": [{**NOTICE, "code": "file-content"}]}).encode()
    headers = {"Content-Type": "image/png"}
    if header is not None:
        headers["Inkbox-Notices"] = header
    response = httpx.Response(200, content=content, headers=headers)
    with make_client(lambda _: response) as client:
        with patch.object(response, "json", side_effect=AssertionError("Unexpected body scan")) as parse:
            result = client.with_response_metadata(
                lambda scoped: scoped._ids_http.get_bytes(f"/test-agent/avatar{suffix}", accept="image/png"),
            )
            parse.assert_not_called()
    assert result.data == content
    assert result.notices == ([ResponseNotice(**NOTICE)] if header == json.dumps([NOTICE]) else None)
