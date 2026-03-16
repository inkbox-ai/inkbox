"""
inkbox_kernel/tools.py

Tool definitions and executor for browser, email, and phone actions.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from inkbox_kernel.data_models import ToolDefinition

if TYPE_CHECKING:
    from inkbox.agent_identity import AgentIdentity
    from kernel import Kernel

logger = logging.getLogger(__name__)

MAX_PAGE_TEXT = 5_000

# tool definitions (provider-neutral JSON Schema)

TOOLS: list[ToolDefinition] = [
    # browser
    {
        "name": "navigate",
        "description": "Navigate the browser to a URL. Returns the page title and final URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to navigate to"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "get_page_text",
        "description": "Get the visible text content of the current page.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "click_element",
        "description": "Click an element on the page by CSS selector.",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of the element to click"},
            },
            "required": ["selector"],
        },
    },
    {
        "name": "fill_input",
        "description": "Type text into an input field by CSS selector.",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector of the input field"},
                "text": {"type": "string", "description": "Text to type"},
            },
            "required": ["selector", "text"],
        },
    },
    {
        "name": "press_key",
        "description": "Press a keyboard key (e.g. 'Enter', 'Tab', 'Escape').",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Key to press"},
            },
            "required": ["key"],
        },
    },
    {
        "name": "execute_js",
        "description": (
            "Execute JavaScript/TypeScript in the browser. Has access to Playwright's 'page', "
            "'context', and 'browser' objects. Use `return` to send a value back."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "JS/TS code to execute"},
            },
            "required": ["code"],
        },
    },
    # email
    {
        "name": "send_email",
        "description": "Send an email from the agent's mailbox. Set in_reply_to to reply to an existing thread.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string", "description": "Email subject"},
                "body": {"type": "string", "description": "Email body text"},
                "in_reply_to": {"type": "string", "description": "Message ID to reply to (optional)"},
            },
            "required": ["to", "subject", "body"],
        },
    },
    {
        "name": "check_inbox",
        "description": "Check the agent's email inbox. Returns the latest emails.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "read_email",
        "description": "Read a specific email by message ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "message_id": {"type": "string", "description": "The message ID to read"},
            },
            "required": ["message_id"],
        },
    },
    # phone
    {
        "name": "place_call",
        "description": "Place an outbound phone call. Real-time voice interaction requires a WebSocket handler.",
        "parameters": {
            "type": "object",
            "properties": {
                "to_number": {"type": "string", "description": "Phone number in E.164 format (e.g. +15551234567)"},
            },
            "required": ["to_number"],
        },
    },
    {
        "name": "list_calls",
        "description": "List recent phone calls.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_transcript",
        "description": "Get the transcript of a phone call.",
        "parameters": {
            "type": "object",
            "properties": {
                "call_id": {"type": "string", "description": "The call ID"},
            },
            "required": ["call_id"],
        },
    },
]


class ToolExecutor:
    """
    Executes tool calls using Kernel (browser) and Inkbox (email/phone).
    """

    def __init__(
        self,
        kernel_client: Kernel,
        session_id: str,
        identity: AgentIdentity,
    ) -> None:
        self.kernel = kernel_client
        self.session_id = session_id
        self.identity = identity

    def execute(self, name: str, arguments: dict) -> str:
        """
        Dispatch a tool call by name and return the result as a string.

        Args:
            name: Tool name matching one of the TOOLS definitions.
            arguments: Parsed arguments dict from the LLM.

        Returns:
            JSON-encoded result or a human-readable status string.
        """
        handler = getattr(self, f"_tool_{name}", None)
        if not handler:
            return f"Error: unknown tool '{name}'"
        try:
            return handler(**arguments)
        except Exception as e:
            logger.exception("Tool '%s' failed", name)
            return f"Error: {e}"

    ## browser tools (via Kernel's server-side Playwright)

    def _pw(self, code: str) -> object:
        """Execute Playwright code on the Kernel browser and return the result."""
        logger.debug("Playwright execute: %s", code[:120])
        resp = self.kernel.browsers.playwright.execute(self.session_id, code=code)
        if not resp.success:
            raise RuntimeError(resp.error or "Playwright execution failed")
        return resp.result

    def _tool_navigate(self, url: str) -> str:
        result = self._pw(
            f"await page.goto({json.dumps(url)}, {{ waitUntil: 'domcontentloaded' }});"
            f" return {{ title: await page.title(), url: page.url() }};"
        )
        return json.dumps(result)

    def _tool_get_page_text(self) -> str:
        text = self._pw("return await page.innerText('body');")
        if isinstance(text, str) and len(text) > MAX_PAGE_TEXT:
            return text[:MAX_PAGE_TEXT] + f"\n... (truncated, {len(text)} total chars)"
        return text if isinstance(text, str) else json.dumps(text)

    def _tool_click_element(self, selector: str) -> str:
        self._pw(f"await page.click({json.dumps(selector)});")
        return f"Clicked '{selector}'"

    def _tool_fill_input(self, selector: str, text: str) -> str:
        self._pw(f"await page.fill({json.dumps(selector)}, {json.dumps(text)});")
        return f"Filled '{selector}'"

    def _tool_press_key(self, key: str) -> str:
        self._pw(f"await page.keyboard.press({json.dumps(key)});")
        return f"Pressed '{key}'"

    def _tool_execute_js(self, code: str) -> str:
        result = self._pw(code)
        return json.dumps(result) if result is not None else "OK (no return value)"

    ## email tools (via Inkbox)

    def _tool_send_email(
        self,
        to: str,
        subject: str,
        body: str,
        in_reply_to: str | None = None,
    ) -> str:
        msg = self.identity.send_email(
            to=[to],
            subject=subject,
            body_text=body,
            in_reply_to_message_id=in_reply_to,
        )
        return f"Email sent (id: {msg.id})"

    def _tool_check_inbox(self) -> str:
        emails = []
        for i, msg in enumerate(self.identity.iter_emails(page_size=10)):
            if i >= 10:
                break
            emails.append({
                "id": str(msg.id),
                "from": msg.from_address,
                "subject": msg.subject,
                "snippet": msg.snippet,
                "direction": msg.direction,
                "is_read": msg.is_read,
            })
        return json.dumps(emails) if emails else "Inbox is empty"

    def _tool_read_email(self, message_id: str) -> str:
        for msg in self.identity.iter_emails(page_size=50):
            if str(msg.id) == message_id or msg.message_id == message_id:
                return json.dumps({
                    "id": str(msg.id),
                    "from": msg.from_address,
                    "to": msg.to_addresses,
                    "subject": msg.subject,
                    "snippet": msg.snippet,
                    "direction": msg.direction,
                    "is_read": msg.is_read,
                })
        return f"Email '{message_id}' not found"

    ## phone tools (via Inkbox)

    def _tool_place_call(self, to_number: str) -> str:
        call = self.identity.place_call(to_number=to_number)
        return json.dumps({
            "call_id": str(call.id),
            "status": call.status,
            "from": call.local_phone_number,
            "to": call.remote_phone_number,
        })

    def _tool_list_calls(self) -> str:
        calls = self.identity.list_calls(limit=10)
        if not calls:
            return "No calls"
        return json.dumps([
            {
                "id": str(c.id),
                "direction": c.direction,
                "status": c.status,
                "to": c.remote_phone_number,
            }  for c in calls
        ])

    def _tool_get_transcript(self, call_id: str) -> str:
        transcripts = self.identity.list_transcripts(call_id)
        if not transcripts:
            return "No transcript available"
        return json.dumps([
                {
                    "party": t.party,
                    "text": t.text,
                    "ts_ms": t.ts_ms,
                } for t in transcripts
        ])
