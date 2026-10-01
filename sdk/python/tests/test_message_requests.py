"""Request retries preserve logical send identity without changing message types."""

from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest
from inkbox.exceptions import InkboxAPIError

from inkbox._message_requests import post_message, send_key
from inkbox.message_sends import MessageSendsResource
from inkbox import get_message_request_key


def test_network_retry_reuses_generated_key_and_body(monkeypatch):
    monkeypatch.setattr("inkbox._message_requests.time.sleep", lambda _: None)
    transport = MagicMock()
    transport.post.side_effect = [httpx.ReadTimeout("response lost"), {"id": "original"}]
    assert post_message(transport, "/messages", json={"text": "hello"}) == {"id": "original"}
    calls = transport.post.call_args_list
    assert calls[0] == calls[1]
    UUID(calls[0].kwargs["headers"]["Idempotency-Key"])
    assert calls[0].kwargs["headers"]["Prefer"] == "idempotency-replay"


def test_two_intended_messages_have_distinct_default_keys():
    transport = MagicMock()
    post_message(transport, "/messages", json={"text": "hello"})
    post_message(transport, "/messages", json={"text": "hello"})
    keys = [call.kwargs["headers"]["Idempotency-Key"] for call in transport.post.call_args_list]
    assert keys[0] != keys[1]


def test_explicit_key_preserved_after_exhausted_retries(monkeypatch):
    monkeypatch.setattr("inkbox._message_requests.time.sleep", lambda _: None)
    transport = MagicMock()
    transport.post.side_effect = httpx.ReadTimeout("response lost")
    with pytest.raises(httpx.ReadTimeout) as error:
        post_message(transport, "/messages", json={}, idempotency_key="same")
    assert error.value.idempotency_key == "same"
    assert transport.post.call_count == 3


@pytest.mark.parametrize("key", ["", " ", "a" * 256, "line\n", "é"])
def test_invalid_keys_are_rejected(key):
    with pytest.raises(ValueError):
        send_key(key)


def test_lookup_is_read_only_and_uses_key_header():
    transport, mailboxes = MagicMock(), MagicMock()
    identifier = UUID("10000000-0000-0000-0000-000000000001")
    transport.get.return_value = {"message_id": str(identifier)}
    result = MessageSendsResource(transport, mailboxes).lookup(sender_kind="phone_number",
        sender_id=identifier, operation="text.send", idempotency_key="same")
    assert result == identifier
    transport.post.assert_not_called()
    assert transport.get.call_args.kwargs["headers"] == {"Idempotency-Key": "same"}


def test_long_retry_after_returns_the_error_without_retrying(monkeypatch):
    sleep = MagicMock()
    monkeypatch.setattr("inkbox._message_requests.time.sleep", sleep)
    transport = MagicMock()
    error = InkboxAPIError(429, {"error": "rate_limited"})
    error.retry_after_seconds = 60
    transport.post.side_effect = error
    with pytest.raises(InkboxAPIError) as raised:
        post_message(transport, "/messages", json={}, idempotency_key="original")
    assert raised.value is error
    assert error.idempotency_key == "original"
    transport.post.assert_called_once()
    sleep.assert_not_called()


@pytest.mark.parametrize("status,code,count", [(409, "idempotency_in_progress", 3),
    (503, "send_outcome_ambiguous", 3), (409, "result_unavailable", 1)])
def test_retry_contract_preserves_key_and_honors_short_retry_after(monkeypatch, status, code, count):
    sleep = MagicMock()
    monkeypatch.setattr("inkbox._message_requests.time.sleep", sleep)
    transport = MagicMock()
    transport.post.side_effect = InkboxAPIError(status, {"error": code}, retry_after=2)
    with pytest.raises(InkboxAPIError) as raised:
        post_message(transport, "/messages", json={"text": "hello"})
    assert transport.post.call_count == count
    assert all(call == transport.post.call_args_list[0] for call in transport.post.call_args_list)
    assert get_message_request_key(raised.value) == transport.post.call_args.kwargs["headers"]["Idempotency-Key"]
    assert sleep.call_count == count - 1
    if count > 1:
        sleep.assert_called_with(2)


def test_lookup_email_resolves_mailbox_then_uses_original_key():
    transport, mailboxes = MagicMock(), MagicMock()
    mailbox_id, message_id = UUID(int=1), UUID(int=2)
    mailboxes.get.return_value.id = mailbox_id
    transport.get.return_value = {"message_id": str(message_id)}
    assert MessageSendsResource(transport, mailboxes).lookup_email("agent@example.com", idempotency_key="same") == message_id
    mailboxes.get.assert_called_once_with("agent@example.com")
    transport.get.assert_called_once_with("/message-sends/lookup", params={
        "sender_kind": "mailbox", "sender_id": str(mailbox_id), "operation": "mail.send",
    }, headers={"Idempotency-Key": "same"})
    transport.post.assert_not_called()


def test_request_key_accessor_accepts_native_errors():
    error = httpx.ReadTimeout("response lost")
    assert get_message_request_key(error) is None
    error.idempotency_key = "original"
    assert get_message_request_key(error) == "original"
