"""
sdk/python/tests/test_hosted_realtime.py

Tests for HostedRealtimeResource (get_config / set_config) and the
identity-scoped delegators.
"""

from uuid import UUID

from inkbox.phone.types import HostedRealtimeConfig
from sample_data import HOSTED_REALTIME_CONFIG_DICT


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"


class TestHostedRealtimeGet:
    def test_get_no_identity(self, client, transport):
        transport.get.return_value = HOSTED_REALTIME_CONFIG_DICT

        cfg = client._hosted_realtime.get_config()

        transport.get.assert_called_once_with("/hosted-realtime-config", params={})
        assert isinstance(cfg, HostedRealtimeConfig)
        assert cfg.agent_identity_id == UUID(IDENTITY_ID)
        assert cfg.enabled is True
        assert cfg.voice == "warm"
        assert cfg.model == "realtime-standard"
        assert cfg.instructions == "Be concise."

    def test_get_with_identity(self, client, transport):
        transport.get.return_value = HOSTED_REALTIME_CONFIG_DICT

        client._hosted_realtime.get_config(agent_identity_id=UUID(IDENTITY_ID))

        transport.get.assert_called_once_with(
            "/hosted-realtime-config",
            params={"agent_identity_id": IDENTITY_ID},
        )


class TestHostedRealtimeSet:
    def test_set_minimal(self, client, transport):
        """None optionals are omitted from the PUT body entirely."""
        transport.put.return_value = HOSTED_REALTIME_CONFIG_DICT

        client._hosted_realtime.set_config(enabled=True)

        transport.put.assert_called_once_with(
            "/hosted-realtime-config",
            json={"enabled": True},
        )

    def test_set_all_fields(self, client, transport):
        transport.put.return_value = HOSTED_REALTIME_CONFIG_DICT

        cfg = client._hosted_realtime.set_config(
            enabled=True,
            voice="warm",
            model="realtime-standard",
            instructions="Be concise.",
            agent_identity_id=IDENTITY_ID,
        )

        transport.put.assert_called_once_with(
            "/hosted-realtime-config",
            json={
                "enabled": True,
                "agent_identity_id": IDENTITY_ID,
                "voice": "warm",
                "model": "realtime-standard",
                "instructions": "Be concise.",
            },
        )
        assert cfg.enabled is True

    def test_set_disabled(self, client, transport):
        transport.put.return_value = {
            **HOSTED_REALTIME_CONFIG_DICT,
            "enabled": False,
            "voice": None,
            "model": None,
            "instructions": None,
        }

        cfg = client._hosted_realtime.set_config(enabled=False)

        transport.put.assert_called_once_with(
            "/hosted-realtime-config",
            json={"enabled": False},
        )
        assert cfg.enabled is False
        assert cfg.voice is None
        assert cfg.model is None
        assert cfg.instructions is None
