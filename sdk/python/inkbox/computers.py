"""Hosted-computer observations, admission and organization model keys."""
from typing import Literal, NotRequired, TypedDict, cast
from urllib.parse import quote
from inkbox._http import HttpTransport
from inkbox.identities.hosting import HostingHarness, HostingModel
from inkbox.imessage.types import _validate_idempotency_key

ModelProvider = Literal['openai', 'anthropic', 'deepseek']


class HostingProviderCapability(TypedDict):
    id: ModelProvider
    models: list[str]
    funding: list[Literal['organization_key', 'inkbox_credits']]


class HostingCapability(TypedDict):
    harness: HostingHarness
    available: bool
    shape_ids: list[str]
    providers: list[HostingProviderCapability]


class HostingCapabilities(TypedDict):
    version: int
    items: list[HostingCapability]


class HostingAdmission(TypedDict):
    harness: HostingHarness
    tier: NotRequired[str]
    shape_id: NotRequired[str]
    credential_binding_id: NotRequired[str | None]
    default_model: NotRequired[HostingModel]


class ModelKey(TypedDict):
    id: str
    name: str
    provider: ModelProvider
    display_suffix: str | None
    version: int
    revoked: bool
    created_at: NotRequired[str]
    updated_at: NotRequired[str]


class ModelKeyInput(TypedDict):
    provider: ModelProvider
    name: str
    api_key: str


class ModelKeyChange(TypedDict):
    id: str
    version: int
    revoked: bool


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
    harness: HostingHarness | None
    software: ComputerSoftware
    capabilities: list[str]


class HostedTemplateDefaults(TypedDict):
    codex: ComputerTemplate | None
    hermes: ComputerTemplate | None
    claude_code: NotRequired[ComputerTemplate | None]
    opencode: NotRequired[ComputerTemplate | None]
    deepseek: NotRequired[ComputerTemplate | None]
    openclaw: NotRequired[ComputerTemplate | None]


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

    def hosting_capabilities(self) -> HostingCapabilities:
        """Read currently qualified harness, shape, provider and funding choices."""
        return cast(HostingCapabilities, self._http.get('/computers/hosting/capabilities'))

    def hosting_admission(self, options: HostingAdmission) -> bool:
        """Check the selected configuration without reserving capacity."""
        return self._http.post('/computers/hosting/admission', json=options)['allowed']

    def model_keys(self) -> list[ModelKey]:
        return self._http.get('/computers/secret-bindings')['items']

    def create_model_key(self, options: ModelKeyInput, *, idempotency_key: str) -> ModelKey:
        _validate_idempotency_key(idempotency_key)
        return self._http.post('/computers/secret-bindings', json=options,
                               headers={'Idempotency-Key': idempotency_key})

    def rotate_model_key(self, key_id: str, options: ModelKeyInput, *, expected_version: int) -> ModelKeyChange:
        return self._http.put(f'/computers/secret-bindings/{quote(key_id, safe="")}',
                              json={**options, 'expected_version': expected_version})

    def revoke_model_key(self, key_id: str) -> ModelKeyChange:
        return self._http.delete_with_response(f'/computers/secret-bindings/{quote(key_id, safe="")}')

    def usage_history(self, machine_id: str, *, window: Literal['1h', '24h', '7d', '30d'] = '24h') -> UsageHistory:
        return cast(UsageHistory, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/usage/history", params={'window': window}))

    def conversations(self, machine_id: str) -> ConversationList:
        return cast(ConversationList, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/conversations"))

    def conversation(self, machine_id: str, session_id: str, *, before: str | None = None) -> ConversationHistory:
        return cast(ConversationHistory, self._http.get(f"/computers/machines/{quote(machine_id, safe='')}/conversations", params={'session_id': session_id, 'before': before}))

    def session_runs(self, session_id: str) -> list[SessionRun]:
        return self._http.get(f"/computers/sessions/{quote(session_id, safe='')}/runs")['items']
