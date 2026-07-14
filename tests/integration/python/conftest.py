"""
tests/integration/python/conftest.py

Shared fixtures for Python SDK integration tests.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Generator

import httpx
import pytest


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SdkIntegrationConfig:
    base_url: str
    interservice_secret: str
    environment: str
    verbose: bool
    http_timeout: float = 60.0
    poll_timeout: float = 240.0
    poll_interval: float = 5.0


@dataclass
class BootstrapResult:
    email_address: str
    password: str
    user_id: str
    org_id: str
    api_key: str


@dataclass
class SdkIntegrationContext:
    config: SdkIntegrationConfig
    bootstrap: BootstrapResult
    extra_cleanup_org_ids: list[str] = field(default_factory=list)
    _cleaned_up: bool = False

    def register_org_for_cleanup(self, org_id: str) -> None:
        self.extra_cleanup_org_ids.append(org_id)

    def cleanup(self) -> dict[str, Any]:
        if self._cleaned_up:
            return {}
        self._cleaned_up = True
        api_url = f"{self.config.base_url.rstrip('/')}/api/v1"
        account: dict[str, Any] = {
            "user_id": self.bootstrap.user_id,
            "org_id": self.bootstrap.org_id,
        }
        # Omit when empty to stay compatible with servers predating the field.
        if self.extra_cleanup_org_ids:
            account["created_provisional_org_ids"] = self.extra_cleanup_org_ids
        resp = post_with_retry(
            f"{api_url}/testing/cleanup-test-user-organization",
            headers={"X-Interservice-Secret": self.config.interservice_secret},
            json={"accounts": [account]},
            timeout=self.config.http_timeout,
            description="cleanup test org",
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Retrying transport
# ---------------------------------------------------------------------------

# Gateway-level statuses only: the request provably never reached the app, so
# replaying it can't double-create an org. A bare 500 is deliberately absent.
RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 2.0


def post_with_retry(
    url: str,
    *,
    headers: dict[str, str],
    json: dict[str, Any],
    timeout: float,
    description: str,
) -> httpx.Response:
    # Hosted CI runners throw the occasional TLS/TCP reset on the way out. These
    # calls sit in session-scoped setup/teardown, so one reset would otherwise
    # take down the entire suite.
    last_error = ""

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = httpx.post(url, headers=headers, json=json, timeout=timeout)
        except httpx.TransportError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        else:
            if resp.status_code not in RETRYABLE_STATUS:
                return resp
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"

        if attempt == MAX_ATTEMPTS:
            break

        delay = BACKOFF_SECONDS * 2 ** (attempt - 1)
        print(
            f"[sdk-integration] ⚠ {description} failed "
            f"(attempt {attempt}/{MAX_ATTEMPTS}): {last_error} — retrying in {delay:.0f}s",
            flush=True,
        )
        time.sleep(delay)

    raise RuntimeError(
        f"{description} failed after {MAX_ATTEMPTS} attempts. Last error: {last_error}"
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def sdk_integration_config() -> SdkIntegrationConfig:
    base_url = os.environ.get("SDK_INTEGRATION_API_URL", "")
    secret = os.environ.get("SDK_INTEGRATION_INTERSERVICE_SECRET", "")
    env = os.environ.get("SDK_INTEGRATION_ENV", "")

    if not base_url or not secret:
        pytest.skip("SDK_INTEGRATION_API_URL / SDK_INTEGRATION_INTERSERVICE_SECRET not set")

    return SdkIntegrationConfig(
        base_url=base_url,
        interservice_secret=secret,
        environment=env,
        verbose=os.environ.get("SDK_INTEGRATION_VERBOSE", "1") == "1",
    )


@pytest.fixture(scope="session")
def sdk_context(sdk_integration_config: SdkIntegrationConfig) -> Generator[SdkIntegrationContext, None, None]:
    # Session-scoped: one test org/user is bootstrapped per pytest invocation
    # and shared across every test in this directory. Tests are responsible
    # for cleaning up any identities/secrets they create so that later tests
    # see a predictable starting state.
    cfg = sdk_integration_config
    api_url = f"{cfg.base_url.rstrip('/')}/api/v1"

    # Bootstrap a fresh test user + org (with API key) via the testing subapp
    resp = post_with_retry(
        f"{api_url}/testing/create-test-user-organization",
        headers={"X-Interservice-Secret": cfg.interservice_secret},
        json={"create_api_key": True},
        timeout=cfg.http_timeout,
        description="bootstrap test org",
    )
    resp.raise_for_status()
    data = resp.json()
    account = data["accounts"][0]

    bootstrap = BootstrapResult(
        email_address=account["email_address"],
        password=account["password"],
        user_id=account["user_id"],
        org_id=account["org_id"],
        api_key=account["api_key"],
    )

    ctx = SdkIntegrationContext(config=cfg, bootstrap=bootstrap)
    try:
        yield ctx
    finally:
        # Tear down the shared org once at the end of the session
        ctx.cleanup()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log_step(ctx: SdkIntegrationContext, message: str) -> None:
    if ctx.config.verbose:
        print(f"[sdk-integration] {message}", flush=True)


def poll_until(
    description: str,
    fetch: Callable[[], Any],
    *,
    timeout_seconds: float = 240.0,
    interval_seconds: float = 5.0,
    is_ready: Callable[[Any], bool] | None = None,
    verbose: bool = True,
) -> Any:
    if is_ready is None:
        is_ready = bool
    deadline = time.monotonic() + timeout_seconds
    attempt = 0
    while True:
        attempt += 1
        value = fetch()
        if is_ready(value):
            if verbose:
                print(f"[sdk-integration] ✓ {description} (attempt {attempt})", flush=True)
            return value
        if time.monotonic() >= deadline:
            raise AssertionError(
                f"Timed out after {timeout_seconds}s waiting for: {description}"
            )
        if verbose and attempt % 3 == 0:
            print(f"[sdk-integration]   … still waiting: {description} (attempt {attempt})", flush=True)
        time.sleep(interval_seconds)
