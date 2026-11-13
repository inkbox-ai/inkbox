"""Read-only hosted-computer observations. These calls never start a computer."""
from typing import Literal, NotRequired, TypedDict, cast
from urllib.parse import quote
from inkbox._http import HttpTransport


class ComputerSoftware(TypedDict):
    harness_version: str | None
    harness_release: str | None
    os: str | None
    os_version: str | None
    model_gateway: str | None


class ComputerTemplate(TypedDict):
    id: str
    total_disk_bytes: int
    requested_free_bytes: int
    harness: Literal["codex", "hermes"] | None
    software: ComputerSoftware
    capabilities: list[str]


class HostedTemplateDefaults(TypedDict):
    codex: ComputerTemplate | None
    hermes: ComputerTemplate | None


class ComputerTemplates(TypedDict):
    items: list[ComputerTemplate]
    hosted_defaults: HostedTemplateDefaults


class ComputerShape(TypedDict):
    id: str
    vcpus: int
    memory_mib: int
    architecture: str
    available: bool


class ComputerShapes(TypedDict):
    version: int
    items: list[ComputerShape]


class MetricSummary(TypedDict):
    unit: str
    average: float | None
    maximum: float | None
    samples: int
    last_sample_at: str | None


class UsagePoint(TypedDict):
    at: str
    values: dict[str, MetricSummary]


class UsageHistory(TypedDict):
    machine_id: str
    source: str
    resolution_seconds: int
    sample_interval_seconds: int
    missing_intervals: str
    items: list[UsagePoint]


class Conversation(TypedDict):
    id: str
    label: str


class ConversationMessage(TypedDict):
    id: str
    role: str
    text: str
    truncated: bool


class ConversationHistory(TypedDict):
    machine_id: str
    status: str
    session_id: NotRequired[str]
    messages: NotRequired[list[ConversationMessage]]
    next_before: NotRequired[str | None]


class ConversationList(TypedDict):
    machine_id: str
    status: str
    conversations: list[Conversation]
    truncated: NotRequired[bool]


class SessionRun(TypedDict):
    id: str
    state: str
    terminal: bool
    created_at: str


class ComputersResource:
    def __init__(self, http: HttpTransport):
        self._http = http

    def templates(self) -> ComputerTemplates:
        """Read templates and current hosted defaults without reserving capacity."""
        return cast(ComputerTemplates, self._http.get("/computers/templates"))

    def shapes(self) -> ComputerShapes:
        """Read supported allocations; availability does not reserve capacity."""
        return cast(ComputerShapes, self._http.get("/computers/shapes"))

    def usage_history(self, machine_id: str, *, window: Literal['1h', '24h', '7d', '30d'] = '24h') -> UsageHistory:
        return cast(UsageHistory, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/usage/history", params={'window': window}))

    def conversations(self, machine_id: str) -> ConversationList:
        return cast(ConversationList, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/conversations"))

    def conversation(self, machine_id: str, session_id: str, *, before: str | None = None) -> ConversationHistory:
        return cast(ConversationHistory, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/conversations", params={'session_id': session_id, 'before': before}))

    def session_runs(self, session_id: str) -> list[SessionRun]:
        return self._http.get(f"/computers/sessions/{quote(session_id, safe='')}/runs")['items']
