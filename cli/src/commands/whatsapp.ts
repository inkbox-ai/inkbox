import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import type { WhatsAppSendOptions, WhatsAppReactionType } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function buildWhatsAppSendOptions(options: {
  to?: string;
  conversationId?: string;
  replyToMessageId?: string;
  plainReplyFallback?: boolean;
  gifPlayback?: boolean;
  text?: string;
  mediaId?: string;
  idempotencyKey?: string;
}): WhatsAppSendOptions {
  if ((options.to == null) === (options.conversationId == null))
    throw new Error("Pass exactly one of --to or --conversation-id.");
  if (options.to != null && (typeof options.to !== "string" || !/^\+[1-9][0-9]{6,14}$/.test(options.to)))
    throw new Error("Provide one E.164 recipient.");
  if (options.replyToMessageId !== undefined && !options.replyToMessageId) throw new Error("--reply-to-message-id requires a non-empty message ID.");
  if (options.replyToMessageId !== undefined && !options.conversationId) throw new Error("--reply-to-message-id requires --conversation-id.");
  if (options.gifPlayback && !options.mediaId) throw new Error("--gif-playback requires --media-id with an MP4 attachment.");
  if (!options.text?.trim() && !options.mediaId)
    throw new Error("Pass --text, --media-id, or both.");
  return {
    ...(options.to != null ? { to: options.to } : {}),
    ...(options.conversationId
      ? { conversationId: options.conversationId }
      : {}),
    ...(options.replyToMessageId !== undefined ? { replyToMessageId: options.replyToMessageId } : {}),
    ...(options.replyToMessageId !== undefined && options.plainReplyFallback === false ? { plainReplyFallback: false } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.mediaId ? { mediaIds: [options.mediaId] } : {}),
    ...(options.gifPlayback ? { gifPlayback: true } : {}),
    ...(options.idempotencyKey !== undefined
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
  };
}

/** Validate list selectors before making an API request. */
export function buildWhatsAppListOptions(options: {
  startDatetime?: string;
  endDatetime?: string; tz?: string;
}) {
  return {
    ...(options.startDatetime !== undefined ? { startDatetime: options.startDatetime } : {}),
    ...(options.endDatetime !== undefined ? { endDatetime: options.endDatetime } : {}),
    ...(options.tz !== undefined ? { tz: options.tz } : {}),
  };
}

const WHATSAPP_MESSAGE_COLUMNS = [
  "id", "conversationId", "direction", "groupName", "remoteNumber", "senderNumber", "content", "status", "deliveryState",
];

export function registerWhatsAppCommands(program: Command): void {
  const whatsapp = program
    .command("whatsapp")
    .description("WhatsApp direct and inbound group conversations, quoted replies, and reactions");
  const identityCommand = (name: string, description: string) =>
    whatsapp
      .command(name)
      .description(description)
      .requiredOption("-i, --identity <handle>", "Agent identity handle");

  identityCommand(
    "send",
    "Queue a message (acceptance is not delivery confirmation)",
  )
    .option("--to <number>", "One E.164 recipient")
    .option("--reply-to-message-id <id>", "Quote a message in --conversation-id")
    .option("--no-plain-reply-fallback", "Require a native quoted reply; never resend an uncertain quote as plain")
    .option("--conversation-id <id>", "Existing direct or inbound group conversation ID")
    .option("--text <text>", "Message text (at most 4000 characters)")
    .option("--media-id <id>", "Owned attachment ID from upload-media")
    .option("--gif-playback", "Play an MP4 media attachment as an animation")
    .option(
      "--idempotency-key <key>",
      "Stable key for this logical send; reuse after uncertainty",
    )
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const options = buildWhatsAppSendOptions(opts);
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(await identity.sendWhatsApp(options), { json: !!global.json });
      }),
    );

  identityCommand(
    "status",
    "Read fresh channel availability without enabling it",
  ).action(
    withErrorHandler(async function (this: Command, opts) {
      const global = getGlobalOpts(this);
      const status = await createClient(global).identities.getWhatsAppStatus(
        opts.identity,
      );
      output(status, { json: !!global.json });
    }),
  );

  identityCommand(
    "onboarding",
    "Get the agent's WhatsApp message link and QR code without sending a message",
  ).action(
    withErrorHandler(async function (this: Command, opts) {
      const global = getGlobalOpts(this);
      const identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.getWhatsAppOnboarding(), { json: !!global.json });
    }),
  );

  identityCommand(
    "limits",
    "Read effective server policy limits and independent usage",
  ).action(
    withErrorHandler(async function (this: Command, opts) {
      const global = getGlobalOpts(this);
      output(
        await (
          await createClient(global).getIdentity(opts.identity)
        ).getWhatsAppLimits(),
        { json: !!global.json },
      );
    }),
  );

  for (const [name, description, method] of [
    [
      "get <message-id>",
      "Read a message and its current delivery state",
      "getWhatsAppMessage",
    ],
    [
      "get-conversation <conversation-id>",
      "Read conversation metadata",
      "getWhatsAppConversation",
    ],
    [
      "get-reaction <reaction-id>",
      "Read the current versioned reaction receipt",
      "getWhatsAppReaction",
    ],
    [
      "get-media <media-id>",
      "Get fresh temporary attachment access",
      "getWhatsAppMedia",
    ],
  ] as const) {
    identityCommand(name, description).action(
      withErrorHandler(async function (this: Command, id: string, opts) {
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(await identity[method](id), { json: !!global.json });
      }),
    );
  }

  identityCommand("list", "List messages, newest first")
    .option("--conversation-id <id>", "Filter by conversation")
    .option("--thread-id <id>", "Filter a conversation by quote-chain thread")
    .option("--start-datetime <date>", "Inclusive creation date or instant")
    .option("--end-datetime <date>", "Inclusive creation date or instant; bare dates include the whole day")
    .option("--tz <zone>", "IANA timezone for zone-less dates (default UTC)")
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--unread", "Only locally unread messages")
    .option("--unread-only", "Only locally unread messages")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const listOptions = buildWhatsAppListOptions(opts);
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.listWhatsAppMessages({
            conversationId: opts.conversationId,
            threadId: opts.threadId,
            ...listOptions,
            limit: Number(opts.limit),
            offset: Number(opts.offset),
            ...(opts.unread || opts.unreadOnly ? { isRead: false } : {}),
          }),
          {
            json: !!global.json,
            columns: WHATSAPP_MESSAGE_COLUMNS,
          },
        );
      }),
    );

  identityCommand("conversation <conversation-id>", "Read messages in a conversation, newest first")
    .option("--thread-id <id>", "Filter by reply thread")
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(withErrorHandler(async function (this: Command, conversationId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.listWhatsAppMessages({ conversationId, threadId: opts.threadId,
        limit: Number(opts.limit), offset: Number(opts.offset) }), { json: !!global.json, columns: WHATSAPP_MESSAGE_COLUMNS });
    }));

  identityCommand("react <message-id>", "Submit a reaction; acceptance is not an applied reaction")
    .option("--reaction <name>", "love, like, dislike, laugh, emphasize, question, or eyes")
    .option("--custom-emoji <emoji>", "Exact custom emoji; exclusive with --reaction")
    .requiredOption("--idempotency-key <key>", "Stable key; reuse it after uncertainty")
    .action(withErrorHandler(async function (this: Command, messageId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.sendWhatsAppReaction({ messageId, reaction: opts.reaction as WhatsAppReactionType | undefined, customEmoji: opts.customEmoji, idempotencyKey: opts.idempotencyKey }), { json: !!global.json });
    }));
  identityCommand("remove-reaction <reaction-id>", "Remove this version of your reaction, without affecting a newer one")
    .alias("unreact")
    .requiredOption("--idempotency-key <key>", "Stable removal key; reuse it after uncertainty")
    .action(withErrorHandler(async function (this: Command, reactionId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.removeWhatsAppReaction(reactionId, opts.idempotencyKey), { json: !!global.json });
    }));
  identityCommand("thread <message-id>", "Read chronological visible replies to a quote-chain root")
    .option("--limit <n>", "Maximum results, 1–200", "50").option("--cursor <cursor>", "Opaque cursor from this thread")
    .action(withErrorHandler(async function (this: Command, messageId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.getWhatsAppThread(messageId, { limit: Number(opts.limit), cursor: opts.cursor }), { json: !!global.json });
    }));
  identityCommand("conversation-thread <conversation-id> <thread-id>", "Read a quote chain by conversation and thread ID")
    .option("--limit <n>", "Maximum results, 1–200", "50").option("--cursor <cursor>", "Opaque cursor from this thread")
    .action(withErrorHandler(async function (this: Command, conversationId: string, threadId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.getWhatsAppConversationThread(conversationId, threadId, { limit: Number(opts.limit), cursor: opts.cursor }), { json: !!global.json });
    }));

  identityCommand(
    "conversations",
    "List conversations with local unread counts",
  )
    .option("--start-datetime <date>", "Inclusive creation date or instant")
    .option("--end-datetime <date>", "Inclusive creation date or instant; bare dates include the whole day")
    .option("--tz <zone>", "IANA timezone for zone-less dates (default UTC)")
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--participants <addresses...>", "Match any email address or E.164 phone number")
    .option("--contact-id <id>", "Match a saved contact; mutually exclusive with --participants")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const listOptions = buildWhatsAppListOptions(opts);
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.listWhatsAppConversations({
            ...listOptions,
            participants: opts.participants,
            contactId: opts.contactId,
            limit: Number(opts.limit),
            offset: Number(opts.offset),
          }),
          {
            json: !!global.json,
            columns: [
              "id",
              "groupName",
              "remoteNumber",
              "participants",
              "latestText",
              "unreadCount",
              "latestMessageAt",
            ],
          },
        );
      }),
    );

  identityCommand(
    "upload-media <file>",
    "Upload one attachment (at most 20 MiB); reuse its ID when sending",
  )
    .option(
      "--content-type <type>",
      "Attachment MIME type",
      "application/octet-stream",
    )
    .action(
      withErrorHandler(async function (this: Command, file: string, opts) {
        if ((await stat(file)).size > 20 * 1024 * 1024)
          throw new Error("WhatsApp media must be at most 20 MiB.");
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.uploadWhatsAppMedia({
            content: await readFile(file),
            filename: basename(file),
            contentType: opts.contentType,
          }),
          { json: !!global.json },
        );
      }),
    );

  identityCommand(
    "mark-read",
    "Mark local history read through an exact message; sends no remote receipt",
  )
    .requiredOption("--conversation-id <id>", "Conversation ID")
    .requiredOption("--through-message-id <id>", "Last visible message ID")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.markWhatsAppRead(
            opts.conversationId,
            opts.throughMessageId,
          ),
          { json: !!global.json },
        );
      }),
    );
}
