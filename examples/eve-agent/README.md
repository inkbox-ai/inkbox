# Inkbox channel for Eve

An Eve agent whose conversations arrive through the Inkbox Chat SDK adapter.
Incoming email, SMS/MMS, iMessage, Slack, and A2A messages start or resume the Eve
session for their conversation. Replies return through Inkbox in that same
conversation.

## Setup

1. Use Node.js 26. Install dependencies with `npm install`. In this repository,
   the adapter dependency links the local package, which must be built first.
   For a standalone project, replace the `file:` dependency with a published
   adapter version.
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
- `concurrency: "concurrent"` lets Eve manage a new input during an active turn.
- Thread IDs preserve the Inkbox identity, channel, and conversation. A stable
  message-based idempotency key is passed to Eve on every inbound send.
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
- The sample provides no privileged tools. Add only the tools your application
  needs, with explicit authorization for external actions. A remote sender is
  not automatically the owner of the agent.

The [adapter documentation](../../adapters/chat-sdk/README.md) describes transport
capabilities. See [Eve channels](https://eve.dev/docs/channels) for host behavior.
