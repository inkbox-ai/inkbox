"""
browser-use/src/tools.py

Tool definitions for email actions, registered on a Browser Use Controller.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from browser_use import ActionResult, Controller

if TYPE_CHECKING:
    from inkbox import Inkbox
    from inkbox.agent_identity import AgentIdentity

logger = logging.getLogger(__name__)


# ── Tool param models ─────────────────────────────────────────────────────

class SendEmailArgs(BaseModel):
    to: list[str] = Field(min_length=1, description="List of recipient email addresses.")
    subject: str = Field(min_length=1, description="Email subject line.")
    body_text: str = Field(min_length=1, description="Plain text body of the email.")
    body_html: str | None = Field(default=None, description="Optional HTML body.")
    cc: list[str] = Field(default_factory=list, description="CC recipients.")
    bcc: list[str] = Field(default_factory=list, description="BCC recipients.")
    in_reply_to_message_id: str | None = Field(default=None, description="Message ID to reply to (for threading).")


class ListEmailsArgs(BaseModel):
    direction: str | None = Field(default=None, description='Filter by "inbound" or "outbound". Leave empty for all.')
    limit: int = Field(default=20, description="Maximum number of emails to return.")


class CheckUnreadEmailsArgs(BaseModel):
    limit: int = Field(default=20, description="Maximum number of unread emails to return.")


class MarkEmailsReadArgs(BaseModel):
    message_ids: list[str] = Field(min_length=1, description="List of message IDs to mark as read.")


class GetThreadArgs(BaseModel):
    thread_id: str = Field(min_length=1, description="Thread ID to retrieve.")


class GetEmailArgs(BaseModel):
    message_id: str = Field(min_length=1, description="Message ID of the email to read in full.")


# ── Helpers ───────────────────────────────────────────────────────────────

def _sdk_to_dict(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {key: _sdk_to_dict(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sdk_to_dict(item) for item in value]
    if hasattr(value, "__dict__"):
        return {
            key: _sdk_to_dict(item)
            for key, item in vars(value).items()
            if not key.startswith("_")
        }
    return value


def _format_json(data: Any) -> str:
    return json.dumps(data, indent=2, default=str)


# ── Controller builder ────────────────────────────────────────────────────

def build_controller(inkbox_client: Inkbox, identity: AgentIdentity) -> Controller:
    """
    Build a Browser Use Controller with Inkbox email tools registered.

    Args:
        inkbox_client: Authenticated Inkbox client.
        identity: The agent identity (with mailbox) to use for email tools.

    Returns:
        A Controller with all custom tools registered.
    """
    controller = Controller()

    @controller.registry.action("Send an email from the Inkbox identity", param_model=SendEmailArgs)
    async def send_email(params: SendEmailArgs) -> ActionResult:
        payload = {key: value for key, value in params.model_dump(exclude_none=True).items() if value != []}
        sent = await asyncio.to_thread(identity.send_email, **payload)
        return ActionResult(
            extracted_content=f"Email sent. ID: {sent.id}, subject: {sent.subject}",
            long_term_memory=f'Sent email to {payload["to"]} with subject "{payload["subject"]}"',
        )

    @controller.registry.action("List recent emails in the Inkbox mailbox", param_model=ListEmailsArgs)
    async def list_emails(params: ListEmailsArgs) -> ActionResult:
        def _collect() -> list[dict[str, Any]]:
            results = []
            for msg in identity.iter_emails(direction=params.direction):
                results.append(_sdk_to_dict(msg))
                if len(results) >= params.limit:
                    break
            return results

        emails = await asyncio.to_thread(_collect)
        if not emails:
            return ActionResult(extracted_content="No emails found.")
        return ActionResult(extracted_content=_format_json(emails))

    @controller.registry.action("List unread emails in the Inkbox mailbox", param_model=CheckUnreadEmailsArgs)
    async def check_unread_emails(params: CheckUnreadEmailsArgs) -> ActionResult:
        def _collect() -> list[dict[str, Any]]:
            results = []
            for msg in identity.iter_unread_emails():
                results.append(_sdk_to_dict(msg))
                if len(results) >= params.limit:
                    break
            return results

        emails = await asyncio.to_thread(_collect)
        if not emails:
            return ActionResult(extracted_content="No unread emails.")
        return ActionResult(extracted_content=_format_json(emails))

    @controller.registry.action("Mark emails as read in the Inkbox mailbox", param_model=MarkEmailsReadArgs)
    async def mark_emails_read(params: MarkEmailsReadArgs) -> ActionResult:
        await asyncio.to_thread(identity.mark_emails_read, params.message_ids)
        return ActionResult(extracted_content=f"Marked {len(params.message_ids)} email(s) as read.")

    @controller.registry.action("Get a full email thread from the Inkbox mailbox", param_model=GetThreadArgs)
    async def get_thread(params: GetThreadArgs) -> ActionResult:
        thread = await asyncio.to_thread(identity.get_thread, params.thread_id)
        return ActionResult(extracted_content=_format_json(_sdk_to_dict(thread)))

    @controller.registry.action("Read a full email from the Inkbox mailbox", param_model=GetEmailArgs)
    async def read_email(params: GetEmailArgs) -> ActionResult:
        if not identity.mailbox:
            return ActionResult(error="No mailbox linked to this agent identity.")

        msg = await asyncio.to_thread(
            inkbox_client._messages.get,
            identity.mailbox.email_address,
            params.message_id,
        )
        return ActionResult(extracted_content=_format_json(_sdk_to_dict(msg)))

    return controller
