"""
kernel/src/llm.py

Unified LLM client for OpenAI and Anthropic tool-use APIs.
"""

from __future__ import annotations

import json
from typing import Any

import logging

from src.config import Config
from src.data_models import LLMResponse, LLMVendor, ToolCall

logger = logging.getLogger(__name__)


class LLMClient:
    """
    Unified LLM client supporting OpenAI and Anthropic tool-use APIs.
    """

    def __init__(self, provider: str, model: str | None = None) -> None:
        self.provider = LLMVendor(provider)
        self._messages: list = []

        if self.provider == LLMVendor.OPENAI:
            from openai import OpenAI

            self._client = OpenAI()
            self.model = model or Config.DEFAULT_OPENAI_MODEL
        elif self.provider == LLMVendor.ANTHROPIC:
            from anthropic import Anthropic

            self._client = Anthropic()
            self.model = model or Config.DEFAULT_ANTHROPIC_MODEL
        else:
            raise ValueError(f"Unknown provider: {provider}")
        logger.info(
            "LLM client initialized: provider=%s model=%s",
            self.provider.value, self.model,
        )

    ## public methods

    def chat(self, system: str, user_message: str, tool_defs: list[dict]) -> LLMResponse:
        """
        Start a new conversation with a user message.

        Args:
            system: System prompt describing the agent's role and identity.
            user_message: The user's task or instruction.
            tool_defs: Provider-neutral tool definitions (JSON Schema).

        Returns:
            Parsed LLM response with optional tool calls.
        """
        logger.debug(
            "Starting chat with %s (%s), %d tools",
            self.provider, self.model, len(tool_defs),
        )
        self._messages = [{"role": "user", "content": user_message}]
        return self._call(system, tool_defs)

    def follow_up(
        self,
        system: str,
        tool_defs: list[dict],
        response: LLMResponse,
        tool_results: list[tuple[str, str]],
    ) -> LLMResponse:
        """
        Continue the conversation by feeding tool results back to the model.

        Args:
            system: System prompt.
            tool_defs: Provider-neutral tool definitions.
            response: The previous LLMResponse (contains raw data for message history).
            tool_results: List of (tool_call_id, result_string) pairs.

        Returns:
            Next LLM response.
        """
        self._append_assistant(response)
        self._append_tool_results(tool_results)
        return self._call(system, tool_defs)

    ## private methods

    def _call(self, system: str, tool_defs: list[dict]) -> LLMResponse:
        if self.provider == LLMVendor.OPENAI:
            return self._call_openai(system, tool_defs)
        elif self.provider == LLMVendor.ANTHROPIC:
            return self._call_anthropic(system, tool_defs)
        else:
            raise ValueError(f"Unsupported provider: {self.provider}")

    def _call_openai(self, system: str, tool_defs: list[dict]) -> LLMResponse:
        tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"],
                },
            }
            for t in tool_defs
        ]
        response = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}] + self._messages,
            tools=tools,
        )
        message = response.choices[0].message
        logger.debug("OpenAI finish_reason=%s", response.choices[0].finish_reason)
        tool_calls = []
        if message.tool_calls:
            tool_calls = [
                ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=json.loads(tc.function.arguments),
                )
                for tc in message.tool_calls
            ]
        return LLMResponse(text=message.content, tool_calls=tool_calls, _raw=message)

    def _call_anthropic(self, system: str, tool_defs: list[dict]) -> LLMResponse:
        tools = [
            {
                "name": t["name"],
                "description": t["description"],
                "input_schema": t["parameters"],
            } for t in tool_defs
        ]
        response = self._client.messages.create(
            model=self.model,
            system=system,
            messages=self._messages,
            tools=tools,
            max_tokens=4_096,
        )
        tool_calls = []
        text_parts = []
        for block in response.content:
            if block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        arguments=block.input,
                    )
                )
            elif block.type == "text":
                text_parts.append(block.text)
        logger.debug("Anthropic stop_reason=%s, %d tool call(s)", response.stop_reason, len(tool_calls))
        text = "\n".join(text_parts) if text_parts else None
        return LLMResponse(
            text=text,
            tool_calls=tool_calls,
            _raw=response.content,
        )

    def _append_assistant(self, response: LLMResponse) -> None:
        if self.provider == LLMVendor.OPENAI:
            msg = response._raw
            assistant: dict[str, Any] = {
                "role": "assistant",
                "content": msg.content,
            }
            if msg.tool_calls:
                assistant["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            self._messages.append(assistant)
        elif self.provider == LLMVendor.ANTHROPIC:
            self._messages.append({"role": "assistant", "content": response._raw})

    def _append_tool_results(self, results: list[tuple[str, str]]) -> None:
        if self.provider == LLMVendor.OPENAI:
            for tool_call_id, content in results:
                self._messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": content,
                })
        elif self.provider == LLMVendor.ANTHROPIC:
            self._messages.append({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": tid, "content": content}
                    for tid, content in results
                ],
            })
