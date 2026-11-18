# Inkbox channel for Eve

An Eve agent whose conversations arrive through the Inkbox Chat SDK adapter.
Incoming email, SMS/MMS, iMessage, Slack, and A2A messages start or resume the Eve
session for their conversation. Replies return through Inkbox in that same
conversation.

## Setup

1. Use Node.js 26. For a standalone project, replace the `file:` dependency with
   a published adapter version and run `npm install`. In a repository checkout,
   follow the [packed-package installation](../chat-sdk/#install-local-packages),
   substituting `examples/eve-agent` for `examples/chat-sdk`. This installs the
   local SDK and adapter tarballs into the application's dependency tree so they
   share its Chat SDK peer dependency.
2. Configure the variables in `.env.example` using your deployment's environment
   management. Use an identity-scoped `INKBOX_API_KEY` matching
   `INKBOX_AGENT_HANDLE`. Configure model access according to the [Eve setup
   guide](https://eve.dev/docs/getting-started), and set `EVE_MODEL` to your chosen
   model ID.
3. Configure a persistent Redis service at `REDIS_URL`.
4. Start with `npm run dev`. For deployment, use Eve's supported build/start or
   deployment workflow. The channel mounts at `POST /eve/v1/inkbox`.
5. Create an identity webhook subscription targeting your deployment's public
   HTTPS `/eve/v1/inkbox` URL. The [Chat SDK setup example](../chat-sdk/#subscribe-once)
   can create it without replacing an existing signing key. Configure the same
   signing secret in this Eve application's environment.

Channel registration lives in `agent/channels/inkbox.ts`; Eve discovers its default
export. No modification to Eve itself or separate MCP connection is needed for
receiving and replying to messages.

## Behavior

- `streaming: false` sends completed text replies, because email and phone-message
  transports cannot edit an already-sent reply for every streamed token.
- `defaultA2AIntent: "complete"` makes each final A2A answer complete its task.
  This sample sends no intermediate A2A progress posts. If you add them, retain
  the adapter's `"progress"` default and complete the task explicitly.
- Handlers accept new mentions and subscribed conversations, not every
  unmentioned Slack channel post. Slack DMs/group DMs and service-authorized
  phone-message groups are accepted input; configure `onMessage` for a stricter
  application policy.
- `concurrency: "concurrent"` lets Eve manage a new input during an active turn.
- Thread IDs preserve the Inkbox identity, channel, and conversation. A stable
  message-based idempotency key is passed to Eve on every inbound send. This
  deduplicates Eve admission, not outbound Inkbox sends: a retried completion
  may still send twice. Persist and recover outbound operations explicitly when
  your workflow requires that guarantee; A2A replies have their own task semantics.
- Eve manages the webhook's `waitUntil` lifecycle. Input-handler failures are
  reported and rethrown. Monitor both webhook delivery and Eve handoff failures:
  Chat SDK can deduplicate a replay after the original handler failed. Recover a
  failed handoff explicitly using its original Eve idempotency key; do not assume
  a webhook replay will re-execute it.
- Redis stores Chat SDK state; Eve owns durable agent execution and session
  history. Configure both according to your hosting requirements.
- Completed calls save their transcript in Chat thread state as `lastCall`. They
  do **not** start a new replying agent turn in this example. Add a deliberate
  post-call workflow if you want follow-up actions. This is not a live voice
  streaming adapter, and `thread.post()` cannot answer a finished call.
- Deferred email replies do not automatically carry the original inbound
  message as a reply-all anchor. If the thread's recipients change, an ambiguous
  send is refused rather than choosing another audience. For workflows that need
  precise deferred replies, persist the triggering message ID and pass it as
  `replyToMessageId` to `inkbox.send()` with the operation's stable key.
- After reconciling external effects, a deliberate webhook recovery may use Chat
  SDK's `deduplicate: false`. Never make that the default: it bypasses suppression
  and does not make external sends exactly once.
- The sample provides no privileged tools. Add only the tools your application
  needs, with explicit authorization for external actions. A remote sender is
  not automatically the owner of the agent.

The [adapter documentation](../../adapters/chat-sdk/README.md) describes transport
capabilities. See [Eve channels](https://eve.dev/docs/channels) for host behavior.
