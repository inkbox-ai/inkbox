"""
inkbox/phone/realtime/intervene.py

Builders for the intervene frames your main agent sends back on the call
WebSocket to steer a platform-hosted call. Each returns the exact wire dict
(ready for ``json.dumps`` onto the socket). The socket is already scoped to
one call, so none of these carry a ``call_id``.
"""

from __future__ import annotations

from typing import Any


def consult_answer(
    consult_id: str, answer: str, instructions: str | None = None,
) -> dict[str, Any]:
    """Resolve a ``consult.requested`` with an answer for the caller."""
    command: dict[str, Any] = {
        "event": "consult.answer", "consult_id": consult_id, "answer": answer,
    }
    if instructions is not None:
        command["instructions"] = instructions
    return command


def say(text: str) -> dict[str, Any]:
    """Have the voice agent speak ``text`` on the call now."""
    return {"event": "inject", "mode": "say", "text": text}


def inject_context(text: str) -> dict[str, Any]:
    """Add hidden system context to the live session without speaking."""
    return {"event": "inject", "mode": "context", "text": text}


def approve_tool(tool_call_id: str) -> dict[str, Any]:
    """Approve a tool call awaiting a decision."""
    return {"event": "tool.decision", "tool_call_id": tool_call_id, "decision": "approve"}


def deny_tool(tool_call_id: str, reason: str | None = None) -> dict[str, Any]:
    """Deny a tool call awaiting a decision."""
    command: dict[str, Any] = {
        "event": "tool.decision", "tool_call_id": tool_call_id, "decision": "deny",
    }
    if reason is not None:
        command["reason"] = reason
    return command


def update_instructions(instructions: str) -> dict[str, Any]:
    """Replace the live session instructions."""
    return {"event": "update_instructions", "instructions": instructions}


def hang_up(reason: str | None = None) -> dict[str, Any]:
    """Force-end the call."""
    command: dict[str, Any] = {"event": "hang_up"}
    if reason is not None:
        command["reason"] = reason
    return command
