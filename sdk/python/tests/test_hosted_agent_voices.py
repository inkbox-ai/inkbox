"""Voice catalog discovery through the public Python SDK."""

import httpx
import pytest

from inkbox import HostedAgentVoiceCatalog, HostedAgentVoiceOption, Inkbox, InkboxAPIError
from inkbox.phone import HostedAgentVoiceCatalog as PhoneVoiceCatalog
from inkbox.phone import HostedAgentVoiceOption as PhoneVoiceOption


def test_list_voices_parses_options_without_filtering(client, transport):
    transport.get.return_value = {
        "default_voice": "future-voice",
        "voices": [
            {
                "id": "future-voice",
                "name": "Future Voice",
                "description": "A clear, expressive voice.",
                "available": True,
                "preview_url": "https://example.com/voices/future-voice.mp3",
                "future_field": "ignored",
            },
            {
                "id": "unavailable-voice",
                "name": "Unavailable Voice",
                "description": "A warm voice.",
                "available": False,
                "preview_url": None,
            },
            {
                "id": "no-preview-voice",
                "name": "No Preview Voice",
                "description": "A bright voice.",
                "available": True,
            },
        ],
    }

    catalog = client.hosted_agent.list_voices()

    transport.get.assert_called_once_with("/hosted-agent-voices")
    assert HostedAgentVoiceCatalog is PhoneVoiceCatalog
    assert HostedAgentVoiceOption is PhoneVoiceOption
    assert isinstance(catalog, HostedAgentVoiceCatalog)
    assert catalog.default_voice == "future-voice"
    assert catalog.voices == [
        HostedAgentVoiceOption(
            id="future-voice",
            name="Future Voice",
            description="A clear, expressive voice.",
            available=True,
            preview_url="https://example.com/voices/future-voice.mp3",
        ),
        HostedAgentVoiceOption(
            id="unavailable-voice",
            name="Unavailable Voice",
            description="A warm voice.",
            available=False,
        ),
        HostedAgentVoiceOption(
            id="no-preview-voice",
            name="No Preview Voice",
            description="A bright voice.",
            available=True,
        ),
    ]


def test_list_voices_preserves_empty_catalog_and_default(client, transport):
    transport.get.return_value = {"voices": [], "default_voice": "future-default"}

    assert client.hosted_agent.list_voices() == HostedAgentVoiceCatalog(
        voices=[], default_voice="future-default"
    )


@pytest.mark.parametrize("status_code", [200, 401, 403, 404])
def test_list_voices_exact_wire_and_errors(monkeypatch, status_code):
    requests = []
    detail = "Voice catalog is unavailable."

    def handler(request):
        requests.append(request)
        return httpx.Response(
            status_code,
            json=(
                {"voices": [], "default_voice": "future-default"}
                if status_code == 200
                else {"detail": detail}
            ),
        )

    monkeypatch.setattr(httpx, "HTTPTransport", lambda **kwargs: httpx.MockTransport(handler))
    with Inkbox(api_key="sk-test", base_url="https://example.com") as sdk:
        if status_code == 200:
            assert sdk.hosted_agent.list_voices().voices == []
        else:
            with pytest.raises(InkboxAPIError) as caught:
                sdk.hosted_agent.list_voices()
            assert caught.value.status_code == status_code
            assert caught.value.detail == detail

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url) == "https://example.com/api/v1/phone/hosted-agent-voices"
    assert request.content == b""
    assert request.headers["X-API-Key"] == "sk-test"
