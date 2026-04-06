"""
tests/integration/python/conftest.py

Shared fixtures for Python SDK integration tests.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
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
    _cleaned_up: bool = False

    def cleanup(self) -> dict[str, Any]:
        if self._cleaned_up:
            return {}
        self._cleaned_up = True
        api_url = f"{self.config.base_url.rstrip('/')}/api/v1"
        resp = httpx.post(
            f"{api_url}/testing/cleanup-test-user-organization",
            headers={"X-Interservice-Secret": self.config.interservice_secret},
            json={
                "user_id": self.bootstrap.user_id,
                "org_id": self.bootstrap.org_id,
            },
            timeout=self.config.http_timeout,
        )
        resp.raise_for_status()
        return resp.json()


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


@pytest.fixture()
def sdk_context(sdk_integration_config: SdkIntegrationConfig) -> Generator[SdkIntegrationContext, None, None]:
    cfg = sdk_integration_config
    api_url = f"{cfg.base_url.rstrip('/')}/api/v1"

    resp = httpx.post(
        f"{api_url}/testing/create-test-user-organization",
        headers={"X-Interservice-Secret": cfg.interservice_secret},
        timeout=cfg.http_timeout,
    )
    resp.raise_for_status()
    data = resp.json()

    bootstrap = BootstrapResult(
        email_address=data["email_address"],
        password=data["password"],
        user_id=data["user_id"],
        org_id=data["org_id"],
        api_key=data["api_key"],
    )

    ctx = SdkIntegrationContext(config=cfg, bootstrap=bootstrap)
    try:
        yield ctx
    finally:
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
