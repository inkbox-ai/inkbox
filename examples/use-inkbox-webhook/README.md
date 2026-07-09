# use-inkbox-webhook

Inbound email webhook example — expose a local ASGI handler at a public Inkbox tunnel URL, verify webhook signatures, and auto-reply when mail arrives.

No ngrok required. The handler runs in-process via `inkbox.tunnels.connect()`; Inkbox delivers webhooks to `https://{handle}.inkboxwire.com/hooks/mail`.

## Prerequisites

1. Python ≥ 3.11
2. An Inkbox API key (`INKBOX_API_KEY`) from [inkbox.ai/console](https://inkbox.ai/console)

Signing keys are **per identity** — the example creates one automatically after provisioning the demo identity. You only need `INKBOX_WEBHOOK_SIGNING_KEY` if you want to supply one yourself.

## Run

```bash
cp .env.example .env
# edit .env — set INKBOX_API_KEY only

cd ../../sdk/python
uv run --env-file ../../examples/use-inkbox-webhook/.env \
  python ../../examples/use-inkbox-webhook/webhook_server.py
```

## What it does

1. Creates a unique identity (`webhook-demo-{suffix}` by default; override base via `INKBOX_AGENT_HANDLE`)
2. Creates an identity-scoped webhook signing key (`POST /identities/{handle}/signing-key`)
3. Starts an in-process ASGI app behind `inkbox.tunnels.connect()`
3. Registers a `message.received` webhook subscription on the identity's mailbox
4. Sends a probe email to trigger an inbound webhook
5. Verifies the `X-Inkbox-Signature` header and auto-replies via `reply_all_email()`
6. Deletes the subscription and identity on exit — including on failures after identity creation

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `INKBOX_API_KEY` | Yes | Console API key |
| `INKBOX_WEBHOOK_SIGNING_KEY` | No | Identity signing key; auto-created if unset |
| `INKBOX_AGENT_HANDLE` | No | Base handle; unique suffix appended automatically |
| `INKBOX_ROTATE_SIGNING_KEY` | No | Set to `1` to rotate the identity key via API |

\* Org-level signing keys are deprecated — keys are scoped to each identity via `POST /identities/{handle}/signing-key`.

## Architecture

```
webhook_server.py
├── ASGI app (POST /hooks/mail)  → verify_webhook() + parse MailWebhookPayload
├── inkbox.tunnels.connect()     → public URL without uvicorn/ngrok
└── inkbox.webhooks.subscriptions → message.received fan-out
```

See [`skills/inkbox-tunnels/SKILL.md`](../../skills/inkbox-tunnels/SKILL.md) for tunnel details and [`skills/inkbox-python/SKILL.md`](../../skills/inkbox-python/SKILL.md) for webhook subscription reference.
