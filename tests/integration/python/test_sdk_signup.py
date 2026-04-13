"""
tests/integration/python/test_sdk_signup.py

Live agent-signup coverage for the Python SDK.
"""

from __future__ import annotations

from uuid import uuid4

import httpx
import pytest

from conftest import SdkIntegrationContext, log_step
from inkbox import Inkbox


@pytest.mark.sdk_integration
def test_python_sdk_signup_accepts_custom_handle_and_email_local_part(
    sdk_context: SdkIntegrationContext,
) -> None:
    ctx = sdk_context
    cfg = ctx.config
    suffix = uuid4().hex[:10]
    agent_handle = f"sdk-signup-{suffix}"
    email_local_part = f"sdk.signup.{suffix}"

    log_step(ctx, "sign up agent with explicit handle and email local part")
    signup = Inkbox.signup(
        human_email=ctx.bootstrap.email_address,
        note_to_human="Python SDK integration signup test",
        agent_handle=agent_handle,
        email_local_part=email_local_part,
        base_url=cfg.base_url,
        timeout=cfg.http_timeout,
    )
    assert signup.agent_handle == agent_handle
    assert signup.email_address.startswith(f"{email_local_part}@")

    api_url = f"{cfg.base_url.rstrip('/')}/api/v1"

    log_step(ctx, "mint JWT for human approval")
    jwt_resp = httpx.post(
        f"{api_url}/testing/create-session-jwt",
        headers={"X-Interservice-Secret": cfg.interservice_secret},
        json={
            "user_id": ctx.bootstrap.user_id,
            "org_id": ctx.bootstrap.org_id,
        },
        timeout=cfg.http_timeout,
    )
    jwt_resp.raise_for_status()
    jwt = jwt_resp.json()["jwt"]

    log_step(ctx, "find pending signup and approve it into bootstrap org")
    with httpx.Client(
        base_url=api_url,
        headers={"Authorization": f"Bearer {jwt}"},
        timeout=cfg.http_timeout,
    ) as jwt_client:
        pending = jwt_client.get("/agent-signup/pending")
        pending.raise_for_status()
        pending_agent = next(
            agent for agent in pending.json()["agents"]
            if agent["agent_handle"] == agent_handle
        )
        approved = jwt_client.post(
            f"/agent-signup/{pending_agent['identity_id']}/approve",
            json={"organization_id": ctx.bootstrap.org_id},
        )
        approved.raise_for_status()

    log_step(ctx, "verify signed-up agent can load its identity after approval")
    with Inkbox(api_key=signup.api_key, base_url=cfg.base_url, timeout=cfg.http_timeout) as inkbox:
        identity = inkbox.get_identity(agent_handle)
        assert identity.agent_handle == agent_handle
        assert identity.email_address == signup.email_address
