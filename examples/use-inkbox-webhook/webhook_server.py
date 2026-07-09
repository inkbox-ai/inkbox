"""
Inbound email webhook example — tunnel + signature verification + auto-reply.

Exposes an in-process ASGI handler at a public Inkbox tunnel URL, registers a
``message.received`` webhook subscription, sends a probe email, verifies the
incoming webhook signature, auto-replies once, then cleans up.

Requires INKBOX_API_KEY in the environment (see .env.example).
Optional INKBOX_WEBHOOK_SIGNING_KEY — if unset, an identity-scoped signing
key is created via POST /identities/{handle}/signing-key after the demo
identity is provisioned.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from typing import Any, cast

from inkbox import Inkbox, MailWebhookPayload, verify_webhook
from inkbox.exceptions import InkboxAPIError

WEBHOOK_PATH = "/hooks/mail"
PROBE_SUBJECT = "Webhook probe"
WAIT_SECONDS = 90


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"ERROR: {name} is required.", file=sys.stderr)
        sys.exit(1)
    return value


def _make_handle() -> str:
    base = os.environ.get("INKBOX_AGENT_HANDLE", "webhook-demo").strip()
    suffix = uuid.uuid4().hex[:8]
    return f"{base}-{suffix}"


async def _read_body(receive: Any) -> bytes:
    body = b""
    while True:
        event = await receive()
        if event["type"] != "http.request":
            continue
        body += event.get("body", b"")
        if not event.get("more_body", False):
            break
    return body


async def _send_response(
    send: Any,
    status: int,
    body: bytes,
    content_type: str = "text/plain",
) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", content_type.encode())],
        },
    )
    await send({"type": "http.response.body", "body": body})


def _resolve_signing_secret(inkbox: Inkbox, identity_handle: str) -> str:
    env_secret = os.environ.get("INKBOX_WEBHOOK_SIGNING_KEY", "").strip()
    rotate = os.environ.get("INKBOX_ROTATE_SIGNING_KEY", "").strip().lower()
    if env_secret and rotate not in {"1", "true", "yes"}:
        print("=> Using INKBOX_WEBHOOK_SIGNING_KEY from environment")
        return env_secret

    if rotate in {"1", "true", "yes"}:
        print(f"=> Rotating signing key for identity {identity_handle}")
    else:
        print(f"=> Creating signing key for identity {identity_handle}")

    data = inkbox._api_http.post(
        f"/identities/{identity_handle}/signing-key",
        json={},
    )
    signing_key = data["signing_key"]
    print("   Save the signing key — it is shown only once.")
    return signing_key


async def _cleanup(
    inkbox: Inkbox,
    listener: Any | None,
    serve_task: asyncio.Task[Any] | None,
    sub_id: Any | None,
    identity_handle: str | None,
) -> None:
    print("=> Cleaning up")
    if listener is not None:
        await listener.aclose()
    if serve_task is not None:
        serve_task.cancel()
        try:
            await serve_task
        except asyncio.CancelledError:
            pass
    if sub_id is not None:
        try:
            inkbox.webhooks.subscriptions.delete(sub_id)
            print(f"   Deleted subscription {sub_id}")
        except InkboxAPIError as exc:
            print(f"   Could not delete subscription {sub_id}: {exc}")
    if identity_handle is not None:
        try:
            inkbox.get_identity(identity_handle).delete()
            print(f"   Deleted identity {identity_handle}")
        except InkboxAPIError as exc:
            print(f"   Could not delete identity {identity_handle}: {exc}")
    print("   Done.")


async def main() -> None:
    api_key = _require_env("INKBOX_API_KEY")
    handle = _make_handle()

    with Inkbox(api_key=api_key) as inkbox:
        identity = None
        listener = None
        serve_task: asyncio.Task[Any] | None = None
        sub_id = None
        created_handle: str | None = None
        signing_secret: str | None = None
        webhook_received = asyncio.Event()
        handled_probe = False

        try:
            identity = inkbox.create_identity(handle, display_name="Webhook Demo")
            created_handle = identity.agent_handle
            mailbox = identity.mailbox
            if mailbox is None:
                print("ERROR: Identity has no mailbox.", file=sys.stderr)
                sys.exit(1)
            print(
                f"=> Created identity: {created_handle} ({mailbox.email_address})",
            )

            signing_secret = _resolve_signing_secret(inkbox, created_handle)

            async def asgi_app(scope: dict[str, Any], receive: Any, send: Any) -> None:
                nonlocal handled_probe
                if scope["type"] != "http":
                    return
                if scope["method"] != "POST" or scope.get("path") != WEBHOOK_PATH:
                    await _send_response(send, 404, b"not found")
                    return

                body = await _read_body(receive)
                headers = {
                    key.decode("latin-1"): value.decode("latin-1")
                    for key, value in scope.get("headers", [])
                }
                if not verify_webhook(
                    payload=body,
                    headers=headers,
                    secret=signing_secret or "",
                ):
                    await _send_response(send, 403, b"invalid signature")
                    return

                payload = cast(MailWebhookPayload, json.loads(body))
                event_type = payload.get("event_type")
                message = payload.get("data", {}).get("message", {})
                direction = message.get("direction")
                subject = message.get("subject") or ""

                print(
                    f"=> Webhook: {event_type} direction={direction} "
                    f"subject={subject!r}",
                )

                if (
                    event_type == "message.received"
                    and direction == "inbound"
                    and subject == PROBE_SUBJECT
                    and not handled_probe
                    and created_handle is not None
                ):
                    handled_probe = True
                    stored_message_id = message.get("id")
                    rfc_message_id = message.get("message_id")
                    from_address = message.get("from_address")
                    try:
                        identity_ref = inkbox.get_identity(created_handle)
                        if stored_message_id:
                            identity_ref.reply_all_email(
                                stored_message_id,
                                body_text=(
                                    "Got your webhook — auto-reply from the "
                                    "Inkbox webhook example."
                                ),
                            )
                            print(f"=> Auto-replied via reply_all to {stored_message_id}")
                        elif from_address and rfc_message_id:
                            identity_ref.send_email(
                                to=[from_address],
                                subject=f"Re: {PROBE_SUBJECT}",
                                body_text=(
                                    "Got your webhook — auto-reply from the "
                                    "Inkbox webhook example."
                                ),
                                in_reply_to_message_id=rfc_message_id,
                            )
                            print(f"=> Auto-replied to {from_address}")
                    except InkboxAPIError as exc:
                        print(f"   Auto-reply skipped: {exc}")
                    webhook_received.set()

                await _send_response(send, 200, b"ok")

            print("=> Connecting tunnel (in-process ASGI handler)")
            listener = inkbox.tunnels.connect(name=created_handle, forward_to=asgi_app)
            public_url = listener.public_url
            webhook_url = f"{public_url}{WEBHOOK_PATH}"
            print(f"   Public URL:  {public_url}")
            print(f"   Webhook URL: {webhook_url}")

            serve_task = asyncio.create_task(listener.serve_forever())
            await asyncio.sleep(3)  # allow data plane to connect

            print("=> Creating webhook subscription (message.received)")
            sub = inkbox.webhooks.subscriptions.create(
                mailbox_id=mailbox.id,
                url=webhook_url,
                event_types=["message.received"],
            )
            sub_id = sub.id
            print(f"   Subscription: {sub_id}")

            print("=> Sending probe email to trigger webhook")
            identity.send_email(
                to=[mailbox.email_address],
                subject=PROBE_SUBJECT,
                body_text="Ping from the Inkbox webhook example.",
            )

            print(f"=> Waiting up to {WAIT_SECONDS}s for verified webhook...")
            await asyncio.wait_for(webhook_received.wait(), timeout=WAIT_SECONDS)
            print("=> Webhook received and signature verified")
        except TimeoutError:
            print(
                f"ERROR: No webhook received within {WAIT_SECONDS}s.",
                file=sys.stderr,
            )
            sys.exit(1)
        finally:
            await _cleanup(inkbox, listener, serve_task, sub_id, created_handle)


if __name__ == "__main__":
    asyncio.run(main())
