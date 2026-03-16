"""
kernel/src/data_models.py

Shared data models and enums used across the package.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, TypedDict


class ToolParameterProperty(TypedDict):
    """
    JSON Schema property definition for a tool parameter.
    """
    type: str
    description: str


class ToolParameters(TypedDict, total=False):
    """
    JSON Schema object describing a tool's parameters.
    """
    type: str
    properties: dict[str, ToolParameterProperty]
    required: list[str]


class ToolDefinition(TypedDict):
    """
    Provider-neutral tool definition with JSON Schema parameters.
    """
    name: str
    description: str
    parameters: ToolParameters


class LLMVendor(StrEnum):
    """
    Supported LLM providers.
    """
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


@dataclass
class ToolCall:
    """
    A single tool invocation requested by the LLM.

    Attributes:
        id: Provider-assigned identifier for this tool call (used to match results).
        name: Name of the tool to invoke.
        arguments: Parsed argument dict from the LLM.
    """
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResponse:
    """
    Normalized response from an LLM provider.

    Attributes:
        text: Free-text content from the model, or None if the response is tool-calls only.
        tool_calls: Zero or more tool invocations the model wants executed.
        _raw: Provider-specific response data needed to reconstruct message history.
    """
    text: str | None
    tool_calls: list[ToolCall]
    _raw: Any = field(repr=False)
