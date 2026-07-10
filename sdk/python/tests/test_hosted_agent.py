"""
sdk/python/tests/test_hosted_agent.py

Tests for HostedAgentConfigResource and the hosted-agent identity delegators.
"""

from unittest.mock import MagicMock
from uuid import UUID

from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import _AgentIdentityData
from inkbox.phone.types import CallMode, HostedAgentConfig, PostCallAction
from sample_data import HOSTED_AGENT_CONFIG_DICT, POST_CALL_ACTION_DICT
from sample_data_identities import IDENTITY_DETAIL_DICT


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"


class TestHostedAgentGetConfig:
    def test_get_no_identity(self, client, transport):
        transport.get.return_value = HOSTED_AGENT_CONFIG_DICT

        cfg = client._hosted_agent.get_config()

        transport.get.assert_called_once_with("/hosted-agent-config", params={})
        assert isinstance(cfg, HostedAgentConfig)
        assert cfg.agent_identity_id == UUID(IDENTITY_ID)
        assert cfg.voice == "warm-voice"
        assert cfg.model == "fast-model"
        assert cfg.instructions == "Always offer to text a summary after the call."

    def test_get_with_identity(self, client, transport):
        transport.get.return_value = HOSTED_AGENT_CONFIG_DICT

        client._hosted_agent.get_config(agent_identity_id=IDENTITY_ID)

        transport.get.assert_called_once_with(
            "/hosted-agent-config",
            params={"agent_identity_id": IDENTITY_ID},
        )

    def test_get_accepts_uuid_identity(self, client, transport):
        """UUID objects are stringified in the query params."""
        transport.get.return_value = HOSTED_AGENT_CONFIG_DICT

        client._hosted_agent.get_config(agent_identity_id=UUID(IDENTITY_ID))

        transport.get.assert_called_once_with(
            "/hosted-agent-config",
            params={"agent_identity_id": IDENTITY_ID},
        )

    def test_all_null_config_parses(self, client, transport):
        """A never-configured identity comes back with all fields null."""
        transport.get.return_value = {
            "agent_identity_id": IDENTITY_ID,
            "voice": None,
            "model": None,
            "instructions": None,
        }

        cfg = client._hosted_agent.get_config()

        assert cfg.voice is None
        assert cfg.model is None
        assert cfg.instructions is None


class TestHostedAgentSetConfig:
    def test_set_all_fields(self, client, transport):
        transport.put.return_value = HOSTED_AGENT_CONFIG_DICT

        cfg = client._hosted_agent.set_config(
            voice="warm-voice",
            model="fast-model",
            instructions="Always offer to text a summary after the call.",
            agent_identity_id=IDENTITY_ID,
        )

        transport.put.assert_called_once_with(
            "/hosted-agent-config",
            json={
                "agent_identity_id": IDENTITY_ID,
                "voice": "warm-voice",
                "model": "fast-model",
                "instructions": "Always offer to text a summary after the call.",
            },
        )
        assert cfg.voice == "warm-voice"

    def test_set_minimal_body_resets_to_server_defaults(self, client, transport):
        """None optionals are omitted — the full-replace PUT nulls them server-side."""
        transport.put.return_value = {
            "agent_identity_id": IDENTITY_ID,
            "voice": None,
            "model": None,
            "instructions": None,
        }

        cfg = client._hosted_agent.set_config()

        transport.put.assert_called_once_with("/hosted-agent-config", json={})
        assert cfg.voice is None

    def test_set_partial_sends_only_set_fields(self, client, transport):
        transport.put.return_value = {
            **HOSTED_AGENT_CONFIG_DICT,
            "model": None,
            "instructions": None,
        }

        client._hosted_agent.set_config(voice="warm-voice")

        transport.put.assert_called_once_with(
            "/hosted-agent-config",
            json={"voice": "warm-voice"},
        )

    def test_set_accepts_uuid_identity(self, client, transport):
        """UUID objects are stringified in the PUT body."""
        transport.put.return_value = HOSTED_AGENT_CONFIG_DICT

        client._hosted_agent.set_config(agent_identity_id=UUID(IDENTITY_ID))

        transport.put.assert_called_once_with(
            "/hosted-agent-config",
            json={"agent_identity_id": IDENTITY_ID},
        )

    def test_roundtrip_get_after_set(self, client, transport):
        """set_config and get_config parse the same response shape."""
        transport.put.return_value = HOSTED_AGENT_CONFIG_DICT
        transport.get.return_value = HOSTED_AGENT_CONFIG_DICT

        set_cfg = client._hosted_agent.set_config(
            voice="warm-voice",
            model="fast-model",
            instructions="Always offer to text a summary after the call.",
        )
        got_cfg = client._hosted_agent.get_config()

        assert set_cfg == got_cfg


class TestCallModeEnum:
    def test_wire_values(self):
        assert CallMode.CLIENT_WEBSOCKET.value == "client_websocket"
        assert CallMode.HOSTED_AGENT.value == "hosted_agent"

    def test_accepts_wire_strings(self):
        assert CallMode("hosted_agent") is CallMode.HOSTED_AGENT
        assert CallMode("client_websocket") is CallMode.CLIENT_WEBSOCKET


def _identity():
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityHostedAgentDelegation:
    def test_get_hosted_agent_config_delegates(self):
        identity, inkbox = _identity()
        inkbox._hosted_agent.get_config.return_value = HostedAgentConfig._from_dict(
            HOSTED_AGENT_CONFIG_DICT
        )

        cfg = identity.get_hosted_agent_config()

        inkbox._hosted_agent.get_config.assert_called_once_with(
            agent_identity_id=identity.id
        )
        assert cfg.voice == "warm-voice"

    def test_set_hosted_agent_config_delegates_with_own_id(self):
        identity, inkbox = _identity()

        identity.set_hosted_agent_config(voice="warm-voice", instructions="Be brief.")

        inkbox._hosted_agent.set_config.assert_called_once_with(
            voice="warm-voice",
            model=None,
            instructions="Be brief.",
            agent_identity_id=identity.id,
        )

    def test_list_post_call_actions_delegates(self):
        identity, inkbox = _identity()
        inkbox._calls.post_call_actions.return_value = [
            PostCallAction._from_dict(POST_CALL_ACTION_DICT)
        ]

        actions = identity.list_post_call_actions("call-id")

        inkbox._calls.post_call_actions.assert_called_once_with("call-id")
        assert actions[0].action == "Book cleaning Tue 9:30am"

    def test_place_call_forwards_mode_and_reason(self):
        identity, inkbox = _identity()

        identity.place_call(
            to_number="+15551234567",
            mode=CallMode.HOSTED_AGENT,
            reason="Book a table for two",
        )

        _, kwargs = inkbox._calls.place.call_args
        assert kwargs["mode"] is CallMode.HOSTED_AGENT
        assert kwargs["reason"] == "Book a table for two"

    def test_place_call_defaults_stay_client_websocket(self):
        identity, inkbox = _identity()

        identity.place_call(to_number="+15551234567")

        _, kwargs = inkbox._calls.place.call_args
        assert kwargs["mode"] is CallMode.CLIENT_WEBSOCKET
        assert kwargs["reason"] is None
