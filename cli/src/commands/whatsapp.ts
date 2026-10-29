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
  groupName?: string;
  text?: string;
  mediaId?: string;
  idempotencyKey?: string;
}): WhatsAppSendOptions {
  const recipients = options.to
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!!recipients?.length === !!options.conversationId)
    throw new Error("Pass exactly one of --to or --conversation-id.");
  if (recipients && (recipients.length < 1 || recipients.length > 8 || new Set(recipients).size !== recipients.length || recipients.some(value => !/^\+[1-9][0-9]{6,14}$/.test(value))))
    throw new Error("Provide 1–8 unique E.164 recipients.");
  if (options.replyToMessageId && !options.conversationId) throw new Error("--reply-to-message-id requires --conversation-id.");
  if (options.groupName !== undefined && (!recipients || recipients.length < 2 || !options.groupName.trim() || Array.from(options.groupName).length > 100)) throw new Error("--group-name requires 2–8 recipients and 1–100 characters.");
  if (!options.text?.trim() && !options.mediaId)
    throw new Error("Pass --text, --media-id, or both.");
  return {
    ...(recipients?.length ? { to: recipients.length === 1 ? recipients[0] : recipients } : {}),
    ...(options.conversationId
      ? { conversationId: options.conversationId }
      : {}),
    ...(options.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : {}),
    ...(options.groupName !== undefined ? { groupName: options.groupName } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.mediaId ? { mediaIds: [options.mediaId] } : {}),
    ...(options.idempotencyKey !== undefined
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
  };
}

export function registerWhatsAppCommands(program: Command): void {
  const whatsapp = program
    .command("whatsapp")
    .description("Approved WhatsApp conversations, quoted replies, and reactions");
  const identityCommand = (name: string, description: string) =>
    whatsapp
      .command(name)
      .description(description)
      .requiredOption("-i, --identity <handle>", "Agent identity handle");

  identityCommand(
    "send",
    "Queue a message (acceptance is not delivery confirmation)",
  )
    .option("--to <numbers>", "One E.164 recipient, or 2–8 comma-separated group recipients")
    .option("--group-name <name>", "Creation-only group name; does not rename an existing group")
    .option("--reply-to-message-id <id>", "Quote a message in --conversation-id")
    .option("--conversation-id <id>", "Existing conversation ID")
    .option("--text <text>", "Message text (at most 4000 characters)")
    .option("--media-id <id>", "Owned attachment ID from upload-media")
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
    .option("--direct-only", "Exclude group conversations")
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--unread", "Only locally unread messages")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.listWhatsAppMessages({
            conversationId: opts.conversationId,
            threadId: opts.threadId,
            ...(opts.directOnly ? { includeGroups: false } : {}),
            limit: Number(opts.limit),
            offset: Number(opts.offset),
            ...(opts.unread ? { isRead: false } : {}),
          }),
          {
            json: !!global.json,
            columns: [
              "id",
              "conversationId",
              "direction",
              "remoteNumber",
              "content",
              "status",
              "deliveryState",
            ],
          },
        );
      }),
    );

  identityCommand("react <message-id>", "Submit a reaction; acceptance is not an applied reaction")
    .option("--reaction <name>", "love, like, dislike, laugh, emphasize, question, or eyes")
    .option("--custom-emoji <emoji>", "Exact custom emoji; exclusive with --reaction")
    .requiredOption("--idempotency-key <key>", "Stable key; reuse it after uncertainty")
    .action(withErrorHandler(async function (this: Command, messageId: string, opts) {
      const global = getGlobalOpts(this), identity = await createClient(global).getIdentity(opts.identity);
      output(await identity.sendWhatsAppReaction({ messageId, reaction: opts.reaction as WhatsAppReactionType | undefined, customEmoji: opts.customEmoji, idempotencyKey: opts.idempotencyKey }), { json: !!global.json });
    }));
  identityCommand("remove-reaction <reaction-id>", "Remove this version of your reaction, without affecting a newer one")
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
    .option("--direct-only", "Exclude group conversations")
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.listWhatsAppConversations({
            ...(opts.directOnly ? { includeGroups: false } : {}),
            limit: Number(opts.limit),
            offset: Number(opts.offset),
          }),
          {
            json: !!global.json,
            columns: [
              "id",
              "remoteNumber",
              "participants",
              "isGroup",
              "groupCreationStatus",
              "unresolvedParticipantCount",
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
