"""
tests/integration/python/test_sdk_lifecycle.py

End-to-end lifecycle test for the Python SDK against a live environment.
"""

from __future__ import annotations

import pytest
from inkbox import Inkbox
from conftest import SdkIntegrationContext, log_step, poll_until


@pytest.mark.sdk_integration
def test_python_sdk_lifecycle(sdk_context: SdkIntegrationContext) -> None:
    ctx = sdk_context
    cfg = ctx.config
    api_key = ctx.bootstrap.api_key

    with Inkbox(api_key=api_key, base_url=cfg.base_url, timeout=cfg.http_timeout) as inkbox:

        # ── whoami ──────────────────────────────────────────────────
        log_step(ctx, "whoami")
        whoami = inkbox.whoami()
        assert whoami.organization_id == ctx.bootstrap.org_id

        # ── empty state ────────────────────────────────────────────
        log_step(ctx, "verify empty identity list")
        identities = inkbox.list_identities()
        assert len(identities) == 0

        # ── create identities ─────────────────────────────────────
        log_step(ctx, "create identity alpha with mailbox")
        alpha = inkbox.create_identity("alpha", create_mailbox=True)
        assert alpha.agent_handle == "alpha"
        assert alpha.mailbox is not None
        assert alpha.email_address is not None

        log_step(ctx, "create identity bravo with mailbox")
        bravo = inkbox.create_identity("bravo", create_mailbox=True)
        assert bravo.agent_handle == "bravo"
        assert bravo.mailbox is not None

        log_step(ctx, "list identities shows 2")
        identities = inkbox.list_identities()
        assert len(identities) == 2

        # ── get identity ──────────────────────────────────────────
        log_step(ctx, "get identity alpha")
        alpha_fetched = inkbox.get_identity("alpha")
        assert alpha_fetched.id == alpha.id
        assert alpha_fetched.email_address == alpha.email_address

        # ── send email alpha → bravo ──────────────────────────────
        subject = f"sdk-integration-{cfg.environment}"
        log_step(ctx, f"send email from alpha to bravo: {subject}")
        sent = alpha.send_email(
            to=[bravo.email_address],
            subject=subject,
            body_text="Hello from the Python SDK integration test!",
        )
        assert sent.subject == subject
        assert sent.direction == "outbound"

        # ── poll for delivery ─────────────────────────────────────
        log_step(ctx, "poll for inbound delivery to bravo")

        def fetch_bravo_inbound():
            msgs = []
            for msg in bravo.iter_emails(direction="inbound"):
                msgs.append(msg)
                if len(msgs) >= 50:
                    break
            return msgs

        messages = poll_until(
            "inbound message delivered to bravo",
            fetch_bravo_inbound,
            timeout_seconds=cfg.poll_timeout,
            interval_seconds=cfg.poll_interval,
            is_ready=lambda msgs: any(m.subject == subject for m in msgs),
            verbose=cfg.verbose,
        )
        inbound_msg = next(m for m in messages if m.subject == subject)
        assert inbound_msg.direction == "inbound"

        # ── message detail ────────────────────────────────────────
        log_step(ctx, "get message detail")
        detail = bravo.get_message(inbound_msg.id)
        assert detail.body_text is not None
        assert "Python SDK" in detail.body_text
        assert detail.thread_id is not None

        # ── mark read ─────────────────────────────────────────────
        log_step(ctx, "mark message as read")
        bravo.mark_emails_read([inbound_msg.id])

        # ── thread ────────────────────────────────────────────────
        log_step(ctx, "get thread")
        thread = bravo.get_thread(detail.thread_id)
        assert thread.subject == subject
        assert len(thread.messages) >= 1

        # ── identity update ───────────────────────────────────────
        log_step(ctx, "pause and resume alpha")
        alpha.update(status="paused")
        alpha.refresh()
        assert alpha.status == "paused"
        alpha.update(status="active")
        alpha.refresh()
        assert alpha.status == "active"

        # ── signing key ───────────────────────────────────────────
        log_step(ctx, "create signing key")
        signing_key = inkbox.create_signing_key()
        assert signing_key.signing_key is not None
        assert signing_key.created_at is not None

        # ── cleanup: delete identities ────────────────────────────
        log_step(ctx, "delete identities")
        alpha.delete()
        bravo.delete()

        log_step(ctx, "verify empty after cleanup")
        identities = inkbox.list_identities()
        assert len(identities) == 0

    # ── final test-org cleanup ────────────────────────────────────
    log_step(ctx, "cleanup test organization")
    deleted = ctx.cleanup()
    assert "deleted" in deleted
    log_step(ctx, f"cleanup complete: {deleted['deleted']}")
