"""Tests for Inkbox unified client — mail resources."""

from inkbox import Inkbox
from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.signing_keys import SigningKeysResource


class TestInkboxMailResources:
    def test_creates_mail_resource_instances(self):
        client = Inkbox(api_key="sk-test")

        assert isinstance(client._mailboxes, MailboxesResource)
        assert isinstance(client._messages, MessagesResource)
        assert isinstance(client._threads, ThreadsResource)
        assert isinstance(client._signing_keys, SigningKeysResource)

        client.close()

    def test_context_manager(self):
        with Inkbox(api_key="sk-test") as client:
            assert isinstance(client, Inkbox)

    def test_mail_http_base_url(self):
        client = Inkbox(api_key="sk-test", base_url="https://localhost:8000")
        assert str(client._mail_http._client.base_url) == "https://localhost:8000/api/v1/mail/"
        client.close()
