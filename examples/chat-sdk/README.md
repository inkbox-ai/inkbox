# Inkbox + Chat SDK

A framework-neutral Fetch API webhook handler using persistent Redis state. It
replies to email, SMS/MMS, iMessage, Slack, and A2A messages. Completed-call
transcripts are saved to thread state without attempting to text a finished call.

## Run in an application

1. Use Node.js 22 or newer. For a standalone application, replace both `file:`
   dependencies with matching published versions, then run `npm install`.
   In a repository checkout, use the packed-package installation below after
   building the local SDK and adapter.
2. Configure the environment variables in `.env.example` in your application's
   environment. `INKBOX_API_KEY` must be identity-scoped and match `INKBOX_AGENT_HANDLE`;
   organization-wide keys are not accepted. Do not commit secret values.
3. Mount the exported `POST` from `src/bot.ts` at `/webhooks/inkbox` in your web
   framework. The handler accepts a standard `Request` and returns a `Response`.
4. Create the identity webhook subscription below and expose your handler over
   HTTPS. Send a message to an enabled channel; the example sends one fixed
   acknowledgement back in that conversation.

The example does not include an HTTP server or model integration. Replace the
fixed reply in `receive` with your agent logic. Keep the call branch separate:
`thread.post()` cannot speak into a completed call. An explicit follow-up call or
message should use the SDK and your application's authorization flow.

## Install local packages

Use packed packages instead of source-directory symlinks so the adapter shares
its application's Chat SDK peer dependency. After building `sdk/typescript` and
`adapters/chat-sdk`, set `INKBOX_PACKAGE_DIR` to an empty directory for artifacts
and run these commands from the repository root:

```bash
npm pack ./sdk/typescript --ignore-scripts --pack-destination "$INKBOX_PACKAGE_DIR"
npm pack ./adapters/chat-sdk --ignore-scripts --pack-destination "$INKBOX_PACKAGE_DIR"
cd examples/chat-sdk
npm ci --ignore-scripts
npm install --ignore-scripts --no-save --package-lock=false "$INKBOX_PACKAGE_DIR"/*.tgz
npm run typecheck
```

Use an absolute artifact directory path. The final install replaces the linked
SDK and adapter with their packed contents without changing manifests or locks.
CI uses this same consumer package layout; it does not bypass type incompatibilities
between independently installed Chat SDK copies.

## Subscribe once

This command changes the selected identity's webhook subscriptions. Run it only
for the identity and destination you intend to connect:

```bash
npm run setup
```

Set `INKBOX_WEBHOOK_URL` to the actual public endpoint first. Set
`INKBOX_SIGNING_SECRET_FILE` to a **new file outside the repository**; setup reserves
it without overwriting an existing file. When this identity has no signing key,
subscription creation returns the new key once and setup saves it with restricted
file permissions. Load it into `INKBOX_SIGNING_SECRET` using your secret manager
before accepting deliveries. The secret is never printed.

If a signing key already exists, supply its existing value as
`INKBOX_SIGNING_SECRET`; setup does not rotate it. The empty reserved file is
removed when no new secret is returned. An existing matching subscription is
preserved. If its event list differs, setup stops and asks you to update that
subscription explicitly rather than silently changing other consumers.

The setup command subscribes to message receipts, completed calls, and incoming
A2A tasks; it does not enable or provision channels. Configure each channel on the
identity separately. No call is placed by setup.

## Hosting and state

Use a durable Redis deployment with persistence enabled. Memory-only state loses
subscriptions and replay suppression when the process restarts. Keep each
application and identity's Redis key prefix separate.

This handler awaits processing before returning. On hosts with a request-scoped
background task API, forward it as the Chat SDK `waitUntil` option instead of
starting an untracked promise:

```ts
return handleWebhook(request, { waitUntil });
```

Import `handleWebhook` from `src/bot.ts` and pass your host's request-scoped
`waitUntil` function. The sample reports handler failures without logging message
bodies, and rethrows them so the host can observe failed background work.

Monitor webhook delivery outcomes **and application operations**. Chat SDK may
mark an input as seen before its handler fails, so replaying that webhook can be
suppressed. In a production application, persist the operation and its status,
recover it explicitly, and reuse a stable outbound key with `inkbox.send()`.
Do not assume every webhook failure is retried automatically or that webhook
replay re-executes a failed handler. Avoid logging raw
webhook bodies, credentials, or message content.

See the [adapter guide](../../adapters/chat-sdk/README.md) for capabilities and
limitations and the [Eve example](../eve-agent/) for durable agent sessions.
