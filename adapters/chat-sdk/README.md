# Inkbox adapter for Chat SDK

`@inkbox/chat-sdk-adapter` connects Inkbox conversations to the TypeScript
[Chat SDK](https://chat-sdk.dev/docs). It is a chat transport adapter: incoming
webhooks become Chat SDK messages, and replies use the originating Inkbox
channel. A2A replies bind to the incoming task explicitly through `inkbox.send()`. It does not require an MCP plugin.

Use it directly with Chat SDK or with Eve's `chatSdkChannel` bridge.

For MMS and iMessage voice notes, the adapter waits up to 60 seconds for the signed
`message.transcription_finished` webhook. If it does not arrive, the adapter
reads the original message once. Eve and Chat receive a single original message
with labeled voice-note text and its original attachments, or the attachments and
an unavailable label if transcription failed. `message.raw.text` preserves the
typed caption; `message.raw.voiceNotes` holds per-attachment results. Transcribed
speech is sender content, not approval to perform privileged actions.

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
import { createInkboxAdapter, type InkboxMessage } from "@inkbox/chat-sdk-adapter";

const inkbox = createInkboxAdapter({
  apiKey: process.env.INKBOX_API_KEY!,
  agentHandle: process.env.INKBOX_AGENT_HANDLE!,
  signingSecret: process.env.INKBOX_SIGNING_SECRET!,
  onMessage: (message) => !(message.route.channel === "slack" && message.isBot === true),
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
  const route = (message.raw as InkboxMessage).route;
  if (route.channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await inkbox.send(thread.id, "Hello from Inkbox.", {
    idempotencyKey: `reply:${message.id}`,
    ...(route.channel === "email" ? { replyToMessageId: message.id } : {}),
    ...(route.channel === "a2a" ? { a2aTaskId: route.taskId } : {}),
  });
});

bot.onSubscribedMessage(async (thread, message) => {
  const route = (message.raw as InkboxMessage).route;
  if (route.channel === "voice") {
    await thread.setState({ lastCall: { id: message.id, text: message.text } });
    return;
  }
  await inkbox.send(thread.id, "Thanks for your message.", {
    idempotencyKey: `reply:${message.id}`,
    ...(route.channel === "email" ? { replyToMessageId: message.id } : {}),
    ...(route.channel === "a2a" ? { a2aTaskId: route.taskId } : {}),
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
The examples reject Slack bot-authored inputs to avoid automated reply loops.
The adapter itself retains those inputs; remove or narrow that admission check
only with an explicit policy for which other apps may trigger replies. The
Slack-only check does not reject A2A agent identities.
Use `onMessage` to apply your application's stricter group admission policy if
needed. Admission is not permission to perform privileged actions.

## Channels

| Channel | Incoming context | Replies |
|---|---|---|
| Email | Message, thread, body, attachments | Reply-all within the existing email thread |
| SMS/MMS | Conversation, sender, text, media | Text and media in the same conversation |
| iMessage | Conversation, sender, text, media, reply thread | Text and media; supported reactions and typing |
| Slack | Workspace conversation, thread, and authenticated file attachments | Text or one file per post; message editing/deletion and reactions |
| A2A | Context conversation, incoming task, and message parts | Explicit task-bound reply; progress is the default intent |
| Voice | Completed-call transcript routed to a matching direct messaging conversation | SMS or iMessage follow-up on the call’s originating channel; unresolved calls remain observations |

WhatsApp is not included. Tunnels, vaults, and other non-conversation SDK resources
are not chat channels; use the SDK directly when your application needs them.

Email and phone messages cannot be edited or unsent through this adapter.
Typing is a no-op where unsupported, following Chat SDK semantics. Other unsupported operations fail explicitly rather than claiming to have changed a
remote message. `thread.post(stream)` buffers the stream and sends one completed
message on non-editable channels; it does not post a placeholder or edit each
token. Slack streams are also buffered into one final send.
An accepted or queued send is not proof of delivery. Phone attachment downloads
use message references and fetch a fresh media URL when needed; delivery URLs
are not used as durable attachment references.

### Voice

`call.ended` provides post-call context, not realtime audio. When a call has a
transcript and one matching direct messaging conversation, the adapter delivers
that transcript as a normal incoming message in the existing conversation:

- Calls on a dedicated phone number route to SMS on that same number.
- Calls on a shared or dedicated iMessage number route to an active iMessage
  conversation with the caller.

The call’s recorded origin selects the channel; the adapter never chooses a
channel merely because the caller has the same phone number there. Dedicated
lines must match the identity’s current line. Replies use the resolved
conversation, so the Eve example can process the transcript and send a useful
follow-up by text. This does not make Eve speak during the call.

**Exchange a message on the intended channel before testing a call.** Conversation
lookup currently requires existing message history; a call alone does not create
a discoverable messaging destination. Missing or ambiguous conversations,
inactive iMessage assignments, unsupported origins, and calls involving
additional connected parties remain call-ID-scoped `voice` observations. Calls
without a transcript also remain observations. The examples save those inputs as
`lastCall` without triggering a reply. `thread.post()` remains unsupported on an
unresolved voice thread; no different-channel fallback or initial message is sent.

Use the Inkbox SDK to configure incoming call behavior or explicitly place a
follow-up call. Decide who may authorize that action in your application.

### A2A

An A2A thread is scoped to `contextId`: multiple tasks in the same context share
one conversation and its history. Each incoming message also retains its own
`taskId` in `message.raw.route`. The decoded thread identifies the context, not
which task should receive a reply.

Always pass the originating message's task ID when sending a reply:

```ts
const route = (message.raw as InkboxMessage).route;
if (route.channel === "a2a") {
  await inkbox.send(thread.id, "The result is ready.", {
    a2aTaskId: route.taskId,
    a2aIntent: "complete",
  });
}
```

The adapter checks that the task belongs to this context and receiving identity
before replying. It never chooses the newest task. `thread.post()` has no task
binding and fails for A2A; use `inkbox.send()` with `a2aTaskId` instead. Preserve
that task ID with any queued work so overlapping tasks cannot redirect each
other's replies.

The default intent is `"progress"`, which leaves the task open. Use
`a2aIntent: "ask_caller"`, `"complete"`, or `"fail"` for the corresponding task
transition. Completing one task does not close the context conversation or
complete other tasks. Do not assume ordinary message-send idempotency applies
to A2A task operations. Set `defaultA2AIntent: "complete"` only when every
explicitly bound reply is a final answer. Applications emitting intermediate
replies should keep `"progress"` and complete explicitly.

The Eve example binds task IDs to individual turns: completed turns complete
their task, failures fail it, and interaction prompts ask its caller.

## Configuration

| Option | Meaning |
|---|---|
| `apiKey` | Identity-scoped Inkbox API key, or sync/async function returning the current key |
| `agentHandle` | Existing identity receiving and sending messages |
| `signingSecret` | Existing webhook signing secret, or sync/async resolver returning it |
| `onMessage` | Optional sync/async admission hook; return `false` to ignore an input |
| `defaultA2AIntent` | Default intent for explicitly task-bound A2A replies; defaults to `"progress"` |

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
this also applies to deferred work without a bound message. The Eve example
passes its serialized thread's current message as the anchor when available.
Do not recover an ambiguous send by silently choosing the latest message.

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
  route post-call transcripts to matching messaging conversations, preserve
  unresolved call observations, and configure an identity subscription.
- [Eve agent](../../examples/eve-agent/): route conversations into durable Eve
  sessions with `streaming: false` and persistent Chat state.

CI builds and packs the local SDK and adapter, installs those tarballs into each
example, and typechecks the consumer package layout. The examples do not place
real calls or send live messages during automated checks.

### Retrying phone messages with media

For SMS/MMS and iMessage sends containing media with an explicit `idempotencyKey`,
the adapter reserves the input fingerprint in Chat state before uploading, then
saves the prepared message before sending it. Retries reuse the same payload and
media URLs, including after an adapter restart. Reusing a key with changed text
or attachment input is rejected even while the first upload is in progress. Concurrent preparation asks
the caller to retry with the same key instead of sending another payload.

Use persistent Chat state in production. Each operation uses two records: an
input-fingerprint reservation and a prepared payload containing message text,
media URLs, the send key, and the fingerprint. Each record expires seven days
after its creation. Neither record contains uploaded file bytes. Text-only phone sends do not create these
records or require Chat initialization. Memory state does not provide recovery
across process restarts. A crash during upload
before preparation is saved can leave an unused upload; no send occurs before
preparation is saved. An expired preparation lock can also permit another upload,
but all senders use the single immutable saved payload.

An expired media URL is never refreshed under an existing operation key. Reconcile
the original send before creating a new operation. This preserves the backend's
idempotency protection; it is not an exactly-once delivery guarantee.

Callback-only attachments (`fetchData` without a stable reference, URL, or supplied
bytes) must remain readable on each retry so the adapter can fingerprint their
content and reject changed input. A saved prepared URL does not bypass this
check. After a prepared record expires, reconcile the original send before
attempting recovery; do not assume a new upload will replay the original result.
