# Inkbox adapter for Chat SDK

`@inkbox/chat-sdk-adapter` connects Inkbox conversations to the TypeScript
[Chat SDK](https://chat-sdk.dev/docs). It is a chat transport adapter: incoming
webhooks become Chat SDK messages, and `thread.post()` sends a reply through the
originating Inkbox channel. It does not require an MCP plugin.

Use it directly with Chat SDK or with Eve's `chatSdkChannel` bridge.

## Install

```bash
npm install @inkbox/chat-sdk-adapter chat @chat-adapter/state-redis
```

Requires Node.js 22 or newer and Chat SDK 4.45 or newer within major version 4.
Use Node.js 26 for the included Eve example. The adapter and `@inkbox/sdk` release
with matching versions; applications do not need to install the SDK separately
unless they use its other APIs.

## Quick start

```ts
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";
import { createInkboxAdapter } from "@inkbox/chat-sdk-adapter";

const inkbox = createInkboxAdapter({
  apiKey: process.env.INKBOX_API_KEY!,
  agentHandle: process.env.INKBOX_AGENT_HANDLE!,
  signingSecret: process.env.INKBOX_SIGNING_SECRET!,
});

const bot = new Chat({
  userName: "assistant",
  adapters: { inkbox },
  concurrency: "queue",
  state: createRedisState({
    url: process.env.REDIS_URL!,
    keyPrefix: `inkbox:${process.env.INKBOX_AGENT_HANDLE!}`,
  }),
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  if (inkbox.decodeThreadId(thread.id).channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await inkbox.send(thread.id, "Hello from Inkbox.", {
    idempotencyKey: `reply:${message.id}`,
    ...(inkbox.decodeThreadId(thread.id).channel === "email"
      ? { replyToMessageId: message.id } : {}),
  });
});

bot.onSubscribedMessage(async (thread, message) => {
  if (inkbox.decodeThreadId(thread.id).channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await inkbox.send(thread.id, "Thanks for your message.", {
    idempotencyKey: `reply:${message.id}`,
    ...(inkbox.decodeThreadId(thread.id).channel === "email"
      ? { replyToMessageId: message.id } : {}),
  });
});

// Mount at a public HTTPS endpoint using your framework's Fetch API support.
export function POST(request: Request) {
  return bot.webhooks.inkbox(request);
}
```

The standalone example uses `concurrency: "queue"` so overlapping inputs wait
rather than being dropped while a handler is busy. The examples handle new
mentions and subscribed conversations, not every unmentioned Slack channel post.
Slack DMs and group DMs count as addressed input. Email, phone messages (including
service-authorized groups), A2A, and call observations are treated as directed
inputs; the adapter does not impose a text-mention syntax on those channels.
Use `onMessage` to apply your application's stricter group admission policy if
needed. Admission is not permission to perform privileged actions.

## Channels

| Channel | Incoming context | Replies |
|---|---|---|
| Email | Message, thread, body, attachments | Reply-all within the existing email thread |
| SMS/MMS | Conversation, sender, text, media | Text and media in the same conversation |
| iMessage | Conversation, sender, text, media, reply thread | Text and media; supported reactions and typing |
| Slack | Workspace conversation, thread, and authenticated file attachments | Text or one file per post; message editing/deletion and reactions |
| A2A | Incoming task and message parts | A task reply; progress is the default intent |
| Voice | Completed-call transcript | No chat reply to a completed call; explicit SDK call operations |

WhatsApp is not included. Tunnels, vaults, and other non-conversation SDK resources
are not chat channels; use the SDK directly when your application needs them.

Email and phone messages cannot be edited or unsent through this adapter.
Unsupported operations fail explicitly rather than claiming to have changed a
remote message. `thread.post(stream)` buffers the stream and sends one completed
message on non-editable channels; it does not post a placeholder or edit each
token. Slack streams are also buffered into one final send.
An accepted or queued send is not proof of delivery. Phone attachment downloads
use message references and fetch a fresh media URL when needed; delivery URLs
are not used as durable attachment references.

### Voice

`call.ended` provides post-call context, not realtime audio. A voice thread is
bound to the completed call. `thread.post()` is intentionally unsupported for
voice: it must not silently start a new call or send an unrelated text.

Use the Inkbox SDK to configure incoming call behavior or explicitly place a
follow-up call. Decide who may authorize that action in your application. The
included examples preserve the transcript in Chat state without contacting anyone.

### A2A

An A2A thread is an incoming task, not a phone-number conversation. An ordinary
chat reply records progress without closing the task. To ask the caller a question,
complete the task, or report failure, use `inkbox.send(thread.id, text,
{ a2aIntent: "ask_caller" | "complete" | "fail" })` with the appropriate intent. Do not assume ordinary message-send
idempotency applies to A2A task operations. Set `defaultA2AIntent: "complete"`
when every posted A2A reply is a final answer, as in the Eve example. Applications
that emit intermediate posts should retain the `"progress"` default and complete
explicitly.

## Configuration

| Option | Meaning |
|---|---|
| `apiKey` | Identity-scoped Inkbox API key, or sync/async function returning the current key |
| `agentHandle` | Existing identity receiving and sending messages |
| `signingSecret` | Existing webhook signing secret, or sync/async resolver returning it |
| `onMessage` | Optional sync/async admission hook; return `false` to ignore an input |
| `defaultA2AIntent` | Intent for ordinary A2A posts; defaults to `"progress"` |

Use an identity-scoped API key matching `agentHandle`; organization-wide keys are
not accepted by the adapter. Credential resolvers are evaluated again for outbound
SDK operations. Store
credentials in your application's secret manager. `onMessage` runs before content
hydration: email text can still be a truncated preview. Use it for admission based
on event metadata, not authorization decisions that require a complete body.
Do not derive an owner identity
or privileged execution context from a remote message sender.

Configure a persistent Chat SDK state adapter. The same state backend must be
available to every process handling this application's conversations. Use a
separate key prefix for separate applications or identities. In-memory state is
only suitable for local experiments where losing subscriptions and replay state
on restart is acceptable.

### Message identifiers

Chat SDK message IDs are opaque and scoped to their thread. Use `message.id` with
Chat SDK methods; do not parse it or pass it directly to an Inkbox REST endpoint.
For SDK operations, the original channel message ID is `message.raw.id` when
the message is typed as `Message<InkboxMessage>`.

### Retrying sends

When retrying a known outbound operation, preserve a stable application key:

```ts
await inkbox.send(thread.id, "Your request is ready.", {
  idempotencyKey: operationId,
});
```

`thread.post()` creates a new send operation. Re-running a handler that calls it
is not an exactly-once guarantee for external side effects. A2A uses its task
reply semantics rather than ordinary send-key deduplication.

Chat SDK records deduplication before invoking the application handler. A failed
handler can therefore leave a message marked as seen: replaying its webhook may
not run the handler again. Persist application operations and their status in a
durable job store, monitor handler failures, and recover the failed operation
explicitly using the original outbound key. Do not rely on webhook replay as a
universal recovery mechanism or clear deduplication state indiscriminately.

After reconciling any external effects from the earlier attempt, an application
can deliberately replay a delivery with the Chat SDK option `deduplicate: false`.
That bypasses duplicate suppression; it is not safe to enable globally and does
not make sends exactly once. Keep the original operation key for a retry. Give
different intended replies different keys, even when they answer the same input.

### Email reply recipients

For an email reply, pass the triggering Chat message ID explicitly:

```ts
await inkbox.send(thread.id, "The answer to your email.", {
  replyToMessageId: message.id,
  idempotencyKey: operationId,
});
```

The anchor controls reply-all recipients. Save it with deferred work instead of
assuming the newest email has the same audience. A send without an explicit
anchor is refused when the thread's changing recipients make the choice ambiguous;
this also applies to deferred Eve replies. Do not recover such a failure by
silently choosing the latest message.

## Webhook setup

Create an identity-owned subscription with its URL set to your public webhook
endpoint. The [setup example](../../examples/chat-sdk/#subscribe-once) checks for
an existing subscription, does not rotate a signing key, and saves a newly returned
one-time secret to a new private file without logging it.

Subscribe only to the input events you need:

```ts
const eventTypes = [
  "message.received",
  "text.received",
  "imessage.received",
  "call.ended",
  "slack.dm_received",
  "slack.group_dm_received",
  "slack.channel_message_received",
  "slack.mention_received",
  "slack.thread_reply_received",
  "a2a.task.created",
  "a2a.task.message",
];
```

A webhook subscription does not provision a mailbox, number, Slack connection, or
call configuration. Enable the channels you want on the identity separately.
Existing signing keys cannot be read back as plaintext. If you already have one,
use the copy in your secret manager; replacing it affects other subscriptions.

Pass the original request body to the adapter without parsing or reserializing it
first. If your host provides `waitUntil`, pass it through:

```ts
return bot.webhooks.inkbox(request, { waitUntil });
```

Identity resolution and required message enrichment complete before the webhook
is acknowledged. Transient lookup or enrichment failures can fail that delivery
without permanently poisoning adapter initialization. When `waitUntil` is supplied,
only the subsequent Chat handler work runs in the host's background lifecycle.
Without it, the handler waits for processing. Do not launch an untracked background
promise that can be terminated after returning a response. Monitor delivery
outcomes and application-handler failures separately. Webhook replay can recover
some delivery failures, but a message already admitted by Chat SDK may remain
deduplicated after its handler fails. Recover that application operation explicitly.
A successful webhook response is not an assurance that your agent completed its
work, and failed deliveries are not universally retried automatically.

## Examples

- [Framework-neutral Chat SDK handler](../../examples/chat-sdk/): receive, reply,
  preserve completed-call context, and configure an identity subscription.
- [Eve agent](../../examples/eve-agent/): route conversations into durable Eve
  sessions with `streaming: false` and persistent Chat state.

CI builds and packs the local SDK and adapter, installs those tarballs into each
example, and typechecks the consumer package layout. The examples do not place
real calls or send live messages during automated checks.
