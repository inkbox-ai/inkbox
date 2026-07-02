"""
sdk/python/tests/test_agent_identity.py

Tests for AgentIdentity convenience methods.
"""

import pytest
from unittest.mock import MagicMock
from uuid import UUID

from sample_data_identities import IDENTITY_DETAIL_DICT, IDENTITY_DICT
from sample_data_mail import MESSAGE_DETAIL_DICT, THREAD_DETAIL_DICT

from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import AgentIdentitySummary, _AgentIdentityData
from inkbox.mail.exceptions import InkboxError
from inkbox.mail.types import ForwardMode, MessageDetail, ThreadDetail
from inkbox.phone.types import (
    CallOrigin,
    IncomingCallAction,
    IncomingCallActionConfig,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneTranscript,
    TextConversationUpdateResult,
    TextMessage,
)


def _identity_with_mailbox():
    """Return an AgentIdentity backed by a mock Inkbox client."""
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_mailbox():
    """Return an AgentIdentity with no mailbox assigned."""
    detail = {**IDENTITY_DETAIL_DICT, "mailbox": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_phone():
    """Return an AgentIdentity with no phone number assigned."""
    detail = {**IDENTITY_DETAIL_DICT, "phone_number": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityGetMessage:
    def test_get_message_returns_message_detail(self):
        identity, inkbox = _identity_with_mailbox()
        message_id = MESSAGE_DETAIL_DICT["id"]
        inkbox._messages.get.return_value = MessageDetail._from_dict(MESSAGE_DETAIL_DICT)

        result = identity.get_message(message_id)

        inkbox._messages.get.assert_called_once_with("sales-agent@inkbox.ai", message_id)
        assert isinstance(result, MessageDetail)
        assert str(result.id) == message_id
        assert result.body_text == "Hi there, this is a test message body."

    def test_get_message_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="has no mailbox"):
            identity.get_message("bbbb2222-0000-0000-0000-000000000001")


class TestAgentIdentityForwardEmail:
    def test_forward_email_delegates_to_messages_resource(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._messages.forward.return_value = MagicMock()

        identity.forward_email(
            "bbbb2222-0000-0000-0000-000000000001",
            to=["fwd@example.com"],
            mode=ForwardMode.WRAPPED,
            subject="Fwd: see this",
            body_text="FYI",
            include_original_attachments=False,
        )

        inkbox._messages.forward.assert_called_once_with(
            "sales-agent@inkbox.ai",
            "bbbb2222-0000-0000-0000-000000000001",
            to=["fwd@example.com"],
            cc=None,
            bcc=None,
            mode=ForwardMode.WRAPPED,
            subject="Fwd: see this",
            body_text="FYI",
            body_html=None,
            additional_attachments=None,
            include_original_attachments=False,
            reply_to=None,
        )

    def test_forward_email_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="has no mailbox"):
            identity.forward_email(
                "bbbb2222-0000-0000-0000-000000000001",
                to=["fwd@example.com"],
            )


class TestAgentIdentityGetThread:
    def test_get_thread_returns_thread_detail(self):
        identity, inkbox = _identity_with_mailbox()
        thread_id = THREAD_DETAIL_DICT["id"]
        inkbox._threads.get.return_value = ThreadDetail._from_dict(THREAD_DETAIL_DICT)

        result = identity.get_thread(thread_id)

        inkbox._threads.get.assert_called_once_with("sales-agent@inkbox.ai", thread_id)
        assert isinstance(result, ThreadDetail)
        assert str(result.id) == thread_id
        assert len(result.messages) == 1

    def test_get_thread_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="has no mailbox"):
            identity.get_thread("eeee5555-0000-0000-0000-000000000001")


PHONE_NUMBER_ID = UUID("bbbb2222-0000-0000-0000-000000000001")
IDENTITY_UUID = UUID("eeee5555-0000-0000-0000-000000000001")
CALL_ID = "bbbb2222-0000-0000-0000-000000000001"


class TestAgentIdentitySendText:
    def test_send_text_delegates_to_texts_resource(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._texts.send.return_value = MagicMock(spec=TextMessage)

        identity.send_text(to="+15551234567", text="Hello!")

        inkbox._texts.send.assert_called_once_with(
            PHONE_NUMBER_ID, to="+15551234567", text="Hello!",
        )

    def test_send_text_can_reply_to_conversation(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._texts.send.return_value = MagicMock(spec=TextMessage)
        conv_id = UUID("eeee1111-0000-0000-0000-0000000000fa")

        identity.send_text(conversation_id=conv_id, text="Reply all")

        inkbox._texts.send.assert_called_once_with(
            PHONE_NUMBER_ID, conversation_id=conv_id, text="Reply all",
        )

    def test_send_text_requires_phone(self):
        identity, _ = _identity_without_phone()

        with pytest.raises(InkboxError, match="no phone number assigned"):
            identity.send_text(to="+15551234567", text="Hello!")


class TestAgentIdentityMarkTextRead:
    def test_mark_text_read_delegates_to_texts_resource(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._texts.update.return_value = MagicMock(spec=TextMessage)

        identity.mark_text_read("txt-1")

        inkbox._texts.update.assert_called_once_with(
            PHONE_NUMBER_ID, "txt-1", is_read=True,
        )

    def test_mark_text_read_requires_phone(self):
        identity, _ = _identity_without_phone()

        with pytest.raises(InkboxError, match="no phone number assigned"):
            identity.mark_text_read("txt-1")


class TestAgentIdentityMarkTextConversationRead:
    def test_mark_text_conversation_read_delegates_to_texts_resource(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._texts.update_conversation.return_value = TextConversationUpdateResult(
            remote_phone_number="+15551234567",
            conversation_id=None,
            is_read=True,
            updated_count=3,
        )

        result = identity.mark_text_conversation_read("+15551234567")

        inkbox._texts.update_conversation.assert_called_once_with(
            PHONE_NUMBER_ID, "+15551234567", is_read=True,
        )
        assert result.updated_count == 3

    def test_mark_text_conversation_read_requires_phone(self):
        identity, _ = _identity_without_phone()

        with pytest.raises(InkboxError, match="no phone number assigned"):
            identity.mark_text_conversation_read("+15551234567")


class TestAgentIdentityPlaceCall:
    def test_place_call_dedicated_uses_own_number(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.place.return_value = MagicMock(spec=PhoneCallWithRateLimit)

        result = identity.place_call(
            to_number="+15551234567",
            client_websocket_url="wss://agent.example.com/ws",
        )

        inkbox._calls.place.assert_called_once_with(
            to_number="+15551234567",
            origination=CallOrigin.DEDICATED_NUMBER,
            from_number="+18335794607",
            client_websocket_url="wss://agent.example.com/ws",
        )
        assert result is inkbox._calls.place.return_value

    def test_place_call_dedicated_string_origination(self):
        # A raw "dedicated_number" string takes the same dedicated path.
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.place.return_value = MagicMock(spec=PhoneCallWithRateLimit)

        identity.place_call(to_number="+15551234567", origination="dedicated_number")

        inkbox._calls.place.assert_called_once_with(
            to_number="+15551234567",
            origination="dedicated_number",
            from_number="+18335794607",
            client_websocket_url=None,
        )

    def test_place_call_dedicated_requires_phone(self):
        identity, _ = _identity_without_phone()

        with pytest.raises(InkboxError, match="no phone number assigned"):
            identity.place_call(to_number="+15551234567")

    def test_place_call_shared_scopes_by_identity_id(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.place.return_value = MagicMock(spec=PhoneCallWithRateLimit)

        identity.place_call(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            client_websocket_url="wss://agent.example.com/ws",
        )

        # Shared origination sends the identity id and no from_number.
        inkbox._calls.place.assert_called_once_with(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            agent_identity_id=IDENTITY_UUID,
            client_websocket_url="wss://agent.example.com/ws",
        )

    def test_place_call_shared_does_not_require_phone(self):
        # Shared-line calls work for identities with no dedicated number.
        identity, inkbox = _identity_without_phone()
        inkbox._calls.place.return_value = MagicMock(spec=PhoneCallWithRateLimit)

        identity.place_call(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
        )

        inkbox._calls.place.assert_called_once_with(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            agent_identity_id=IDENTITY_UUID,
            client_websocket_url=None,
        )


class TestAgentIdentityListCalls:
    def test_list_calls_scopes_to_identity_with_defaults(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.list.return_value = [MagicMock(spec=PhoneCall)]

        result = identity.list_calls()

        inkbox._calls.list.assert_called_once_with(
            agent_identity_id=IDENTITY_UUID,
            limit=50,
            offset=0,
            is_blocked=None,
        )
        assert result is inkbox._calls.list.return_value

    def test_list_calls_forwards_filters(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.list.return_value = []

        identity.list_calls(limit=10, offset=20, is_blocked=True)

        inkbox._calls.list.assert_called_once_with(
            agent_identity_id=IDENTITY_UUID,
            limit=10,
            offset=20,
            is_blocked=True,
        )


class TestAgentIdentityListTranscripts:
    def test_list_transcripts_delegates_to_calls_resource(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._calls.transcripts.return_value = [MagicMock(spec=PhoneTranscript)]

        result = identity.list_transcripts(CALL_ID)

        inkbox._calls.transcripts.assert_called_once_with(CALL_ID)
        assert result is inkbox._calls.transcripts.return_value


class TestAgentIdentityIncomingCallAction:
    def test_get_scopes_to_identity(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._incoming_call_action.get.return_value = MagicMock(
            spec=IncomingCallActionConfig
        )

        result = identity.get_incoming_call_action()

        inkbox._incoming_call_action.get.assert_called_once_with(
            agent_identity_id=IDENTITY_UUID,
        )
        assert result is inkbox._incoming_call_action.get.return_value

    def test_set_forwards_all_fields(self):
        identity, inkbox = _identity_with_mailbox()
        inkbox._incoming_call_action.set.return_value = MagicMock(
            spec=IncomingCallActionConfig
        )

        result = identity.set_incoming_call_action(
            incoming_call_action=IncomingCallAction.WEBHOOK,
            client_websocket_url="wss://agent.example.com/ws",
            incoming_call_webhook_url="https://hooks.example.com/incoming-call",
        )

        inkbox._incoming_call_action.set.assert_called_once_with(
            incoming_call_action=IncomingCallAction.WEBHOOK,
            agent_identity_id=IDENTITY_UUID,
            client_websocket_url="wss://agent.example.com/ws",
            incoming_call_webhook_url="https://hooks.example.com/incoming-call",
        )
        assert result is inkbox._incoming_call_action.set.return_value

    def test_set_minimal_forwards_none_optionals(self):
        # The delegator always passes the optionals; the resource drops Nones.
        identity, inkbox = _identity_with_mailbox()
        inkbox._incoming_call_action.set.return_value = MagicMock(
            spec=IncomingCallActionConfig
        )

        identity.set_incoming_call_action(incoming_call_action="auto_reject")

        inkbox._incoming_call_action.set.assert_called_once_with(
            incoming_call_action="auto_reject",
            agent_identity_id=IDENTITY_UUID,
            client_websocket_url=None,
            incoming_call_webhook_url=None,
        )


class TestAgentIdentityUpdate:
    def test_update_with_new_handle_refreshes_cached_tunnel(self):
        identity, inkbox = _identity_with_mailbox()
        renamed = {**IDENTITY_DICT, "agent_handle": "new-handle"}
        inkbox._ids_resource.update.return_value = AgentIdentitySummary._from_dict(renamed)
        refreshed_detail = {
            **IDENTITY_DETAIL_DICT,
            "agent_handle": "new-handle",
            "tunnel": {
                **IDENTITY_DETAIL_DICT["tunnel"],
                "tunnel_name": "new-handle",
                "public_host": "new-handle.inkboxwire.com",
            },
        }
        inkbox._ids_resource.get.return_value = _AgentIdentityData._from_dict(refreshed_detail)

        identity.update(new_handle="new-handle")

        inkbox._ids_resource.get.assert_called_once_with("new-handle")
        assert identity.tunnel is not None
        assert identity.tunnel.tunnel_name == "new-handle"
        assert identity.tunnel.public_host == "new-handle.inkboxwire.com"

    def test_update_without_new_handle_does_not_refresh(self):
        identity, inkbox = _identity_with_mailbox()
        renamed = {**IDENTITY_DICT, "display_name": "New Display"}
        inkbox._ids_resource.update.return_value = AgentIdentitySummary._from_dict(renamed)

        identity.update(display_name="New Display")

        inkbox._ids_resource.get.assert_not_called()
