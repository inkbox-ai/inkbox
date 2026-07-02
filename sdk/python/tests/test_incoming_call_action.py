"""
sdk/python/tests/test_incoming_call_action.py

Tests for IncomingCallActionResource.
"""

from uuid import UUID

from inkbox.phone.types import IncomingCallAction, IncomingCallActionConfig
from sample_data import INCOMING_CALL_ACTION_CONFIG_DICT


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"


class TestIncomingCallActionGet:
    def test_get_no_identity(self, client, transport):
        transport.get.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        cfg = client._incoming_call_action.get()

        transport.get.assert_called_once_with("/incoming-call-action", params={})
        assert cfg.agent_identity_id == UUID(IDENTITY_ID)
        assert cfg.incoming_call_action is IncomingCallAction.WEBHOOK
        assert cfg.client_websocket_url is None
        assert cfg.incoming_call_webhook_url == "https://hooks.example.com/incoming-call"

    def test_get_with_identity(self, client, transport):
        transport.get.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        client._incoming_call_action.get(agent_identity_id=IDENTITY_ID)

        transport.get.assert_called_once_with(
            "/incoming-call-action",
            params={"agent_identity_id": IDENTITY_ID},
        )

    def test_get_accepts_uuid_identity(self, client, transport):
        """UUID objects are stringified in the query params."""
        transport.get.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        client._incoming_call_action.get(agent_identity_id=UUID(IDENTITY_ID))

        transport.get.assert_called_once_with(
            "/incoming-call-action",
            params={"agent_identity_id": IDENTITY_ID},
        )


class TestIncomingCallActionSet:
    def test_set_webhook(self, client, transport):
        transport.put.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        cfg = client._incoming_call_action.set(
            incoming_call_action=IncomingCallAction.WEBHOOK,
            agent_identity_id=IDENTITY_ID,
            incoming_call_webhook_url="https://hooks.example.com/incoming-call",
        )

        transport.put.assert_called_once_with(
            "/incoming-call-action",
            json={
                "incoming_call_action": "webhook",
                "agent_identity_id": IDENTITY_ID,
                "incoming_call_webhook_url": "https://hooks.example.com/incoming-call",
            },
        )
        assert cfg.incoming_call_action is IncomingCallAction.WEBHOOK

    def test_set_minimal(self, client, transport):
        """None optionals are omitted from the PUT body entirely."""
        transport.put.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        client._incoming_call_action.set(incoming_call_action="auto_accept")

        transport.put.assert_called_once_with(
            "/incoming-call-action",
            json={"incoming_call_action": "auto_accept"},
        )

    def test_set_all_fields(self, client, transport):
        transport.put.return_value = {
            **INCOMING_CALL_ACTION_CONFIG_DICT,
            "incoming_call_action": "auto_accept",
            "client_websocket_url": "wss://agent.example.com/ws",
            "incoming_call_webhook_url": None,
        }

        cfg = client._incoming_call_action.set(
            incoming_call_action=IncomingCallAction.AUTO_ACCEPT,
            agent_identity_id=IDENTITY_ID,
            client_websocket_url="wss://agent.example.com/ws",
            incoming_call_webhook_url="https://hooks.example.com/incoming-call",
        )

        transport.put.assert_called_once_with(
            "/incoming-call-action",
            json={
                "incoming_call_action": "auto_accept",
                "agent_identity_id": IDENTITY_ID,
                "client_websocket_url": "wss://agent.example.com/ws",
                "incoming_call_webhook_url": "https://hooks.example.com/incoming-call",
            },
        )
        assert isinstance(cfg, IncomingCallActionConfig)
        assert cfg.agent_identity_id == UUID(IDENTITY_ID)
        assert cfg.incoming_call_action is IncomingCallAction.AUTO_ACCEPT
        assert cfg.client_websocket_url == "wss://agent.example.com/ws"
        assert cfg.incoming_call_webhook_url is None

    def test_set_accepts_uuid_identity(self, client, transport):
        """UUID objects are stringified in the PUT body."""
        transport.put.return_value = INCOMING_CALL_ACTION_CONFIG_DICT

        client._incoming_call_action.set(
            incoming_call_action="auto_reject",
            agent_identity_id=UUID(IDENTITY_ID),
        )

        transport.put.assert_called_once_with(
            "/incoming-call-action",
            json={
                "incoming_call_action": "auto_reject",
                "agent_identity_id": IDENTITY_ID,
            },
        )
