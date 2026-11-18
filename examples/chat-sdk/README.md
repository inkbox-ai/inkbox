# Inkbox + Chat SDK

A framework-neutral Fetch API webhook handler using persistent Redis state. It
replies to email, SMS/MMS, iMessage, addressed Slack input, and A2A messages.
Completed-call transcripts enter a matching SMS or iMessage conversation for a
text acknowledgement; unresolved calls are saved to thread state.

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
fixed reply in `handleMessage` with your agent logic. For resolved post-call
transcripts, the fixed reply is a text in the matching conversation, not speech.
Keep the unresolved `voice` branch separate: `thread.post()` cannot speak into a
completed call or choose a different messaging destination. An explicit follow-up
call should use the SDK and your application's authorization flow.

For post-call testing, **exchange a message on the intended channel first**.
Dedicated phone calls resolve to SMS; shared or dedicated iMessage calls resolve
to an active iMessage conversation. The adapter requires one exact direct
conversation with existing message history and never falls back between channels.
Calls with no transcript, no unique destination, or additional connected parties
remain observations in `lastCall`. See the [voice routing details](../../adapters/chat-sdk/README.md#voice).

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

## Conversation policy

The example handles new mentions and subscribed conversations. It does not
answer an unmentioned post in an unsubscribed Slack channel thread. Slack DMs
and group DMs are addressed input. Service-authorized SMS/iMessage group messages
are handled without requiring a text mention; use the adapter's `onMessage`
hook if your application needs a narrower group policy.

`concurrency: "queue"` preserves overlapping inputs while the current handler
runs. A2A conversations are keyed by `contextId`, so a new task in the same
context keeps the same thread and history. Each reply uses `a2aTaskId` from the
incoming `InkboxMessage`'s `message.raw.route`, not the decoded thread. This
preserves the originating task even when multiple tasks share a context.

A2A acknowledgements are progress replies in this demonstration, not final task
results. Complete actual work through `inkbox.send(thread.id, result, {
a2aTaskId: route.taskId, a2aIntent: "complete" })`, with `route` taken from that
incoming message. Completing a task does not close its context conversation.
`thread.post()` cannot identify the originating task and fails for A2A; retain
the message's task binding for deferred replies instead of selecting the latest
task. Email replies continue to pass `replyToMessageId: message.id`.

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
The example uses one stable key per acknowledgement and supplies the triggering
email as its reply anchor. After reconciling an earlier attempt's external effects,
a recovery handler may use `deduplicate: false` for that replay; do not enable it
for all deliveries or treat it as an exactly-once guarantee.
Do not assume every webhook failure is retried automatically or that webhook
replay re-executes a failed handler. Avoid logging raw
webhook bodies, credentials, or message content.

See the [adapter guide](../../adapters/chat-sdk/README.md) for capabilities and
limitations and the [Eve example](../eve-agent/) for durable agent sessions.

## Messages from other Slack apps

The sample's `onMessage` hook ignores Slack bot-authored input so two automated
responders do not keep replying to each other. The adapter supports those inputs;
replace the sample check only with an explicit policy identifying which apps may
trigger your agent. This Slack-only policy does not block A2A agent messages.
