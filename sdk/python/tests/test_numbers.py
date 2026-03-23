"""
sdk/python/tests/test_numbers.py

Tests for PhoneNumbersResource.
"""

from uuid import UUID

from sample_data import PHONE_NUMBER_DICT, PHONE_TRANSCRIPT_DICT


class TestNumbersList:
    def test_returns_list_of_phone_numbers(self, client, transport):
        transport.get.return_value = [PHONE_NUMBER_DICT]

        numbers = client._numbers.list()

        transport.get.assert_called_once_with("/numbers")
        assert len(numbers) == 1
        assert numbers[0].number == "+18335794607"
        assert numbers[0].type == "toll_free"
        assert numbers[0].status == "active"
        assert numbers[0].client_websocket_url is None

    def test_empty_list(self, client, transport):
        transport.get.return_value = []

        numbers = client._numbers.list()

        assert numbers == []


class TestNumbersGet:
    def test_returns_phone_number(self, client, transport):
        transport.get.return_value = PHONE_NUMBER_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        number = client._numbers.get(uid)

        transport.get.assert_called_once_with(f"/numbers/{uid}")
        assert number.id == UUID(uid)
        assert number.number == "+18335794607"
        assert number.incoming_call_action == "auto_reject"


class TestNumbersUpdate:
    def test_update_incoming_call_action(self, client, transport):
        updated = {**PHONE_NUMBER_DICT, "incoming_call_action": "webhook"}
        transport.patch.return_value = updated
        uid = "aaaa1111-0000-0000-0000-000000000001"

        result = client._numbers.update(uid, incoming_call_action="webhook")

        transport.patch.assert_called_once_with(
            f"/numbers/{uid}",
            json={"incoming_call_action": "webhook"},
        )
        assert result.incoming_call_action == "webhook"

    def test_update_multiple_fields(self, client, transport):
        updated = {
            **PHONE_NUMBER_DICT,
            "incoming_call_action": "webhook",
            "client_websocket_url": "wss://agent.example.com/ws",
            "incoming_call_webhook_url": "https://example.com/hook",
        }
        transport.patch.return_value = updated
        uid = "aaaa1111-0000-0000-0000-000000000001"

        result = client._numbers.update(
            uid,
            incoming_call_action="webhook",
            client_websocket_url="wss://agent.example.com/ws",
            incoming_call_webhook_url="https://example.com/hook",
        )

        transport.patch.assert_called_once_with(
            f"/numbers/{uid}",
            json={
                "incoming_call_action": "webhook",
                "client_websocket_url": "wss://agent.example.com/ws",
                "incoming_call_webhook_url": "https://example.com/hook",
            },
        )
        assert result.client_websocket_url == "wss://agent.example.com/ws"
        assert result.incoming_call_webhook_url == "https://example.com/hook"

    def test_omitted_fields_not_sent(self, client, transport):
        transport.patch.return_value = PHONE_NUMBER_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        client._numbers.update(uid, incoming_call_action="auto_reject")

        _, kwargs = transport.patch.call_args
        assert "client_websocket_url" not in kwargs["json"]
        assert "incoming_call_webhook_url" not in kwargs["json"]


class TestNumbersProvision:
    def test_provision_toll_free(self, client, transport):
        transport.post.return_value = PHONE_NUMBER_DICT

        number = client._numbers.provision(agent_handle="sales-bot", type="toll_free")

        transport.post.assert_called_once_with(
            "/numbers",
            json={"agent_handle": "sales-bot", "type": "toll_free"},
        )
        assert number.type == "toll_free"

    def test_provision_local_with_state(self, client, transport):
        local = {**PHONE_NUMBER_DICT, "type": "local", "number": "+12125551234"}
        transport.post.return_value = local

        number = client._numbers.provision(agent_handle="sales-bot", type="local", state="NY")

        transport.post.assert_called_once_with(
            "/numbers",
            json={"agent_handle": "sales-bot", "type": "local", "state": "NY"},
        )
        assert number.type == "local"

    def test_provision_defaults_to_toll_free(self, client, transport):
        transport.post.return_value = PHONE_NUMBER_DICT

        client._numbers.provision(agent_handle="sales-bot")

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["type"] == "toll_free"
        assert kwargs["json"]["agent_handle"] == "sales-bot"


class TestNumbersRelease:
    def test_release_deletes_by_id(self, client, transport):
        uid = "aaaa1111-0000-0000-0000-000000000001"

        client._numbers.release(uid)

        transport.delete.assert_called_once_with(f"/numbers/{uid}")


class TestNumbersSearchTranscripts:
    def test_search_with_query(self, client, transport):
        transport.get.return_value = [PHONE_TRANSCRIPT_DICT]
        uid = "aaaa1111-0000-0000-0000-000000000001"

        results = client._numbers.search_transcripts(uid, q="hello")

        transport.get.assert_called_once_with(
            f"/numbers/{uid}/search",
            params={"q": "hello", "party": None, "limit": 50},
        )
        assert len(results) == 1
        assert results[0].text == "Hello, how can I help you?"

    def test_search_with_party_and_limit(self, client, transport):
        transport.get.return_value = []
        uid = "aaaa1111-0000-0000-0000-000000000001"

        results = client._numbers.search_transcripts(
            uid, q="test", party="remote", limit=10
        )

        transport.get.assert_called_once_with(
            f"/numbers/{uid}/search",
            params={"q": "test", "party": "remote", "limit": 10},
        )
        assert results == []
