import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import type { WhatsAppSendOptions } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function buildWhatsAppSendOptions(options: {
  to?: string;
  conversationId?: string;
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
  if (recipients && recipients.length !== 1)
    throw new Error("WhatsApp supports exactly one recipient.");
  if (!options.text?.trim() && !options.mediaId)
    throw new Error("Pass --text, --media-id, or both.");
  return {
    ...(recipients?.length ? { to: recipients[0] } : {}),
    ...(options.conversationId
      ? { conversationId: options.conversationId }
      : {}),
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
    .description("Approved dedicated one-to-one WhatsApp messaging");
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

  identityCommand(
    "conversations",
    "List conversations with local unread counts",
  )
    .option("--limit <n>", "Maximum results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (this: Command, opts) {
        const global = getGlobalOpts(this);
        const identity = await createClient(global).getIdentity(opts.identity);
        output(
          await identity.listWhatsAppConversations({
            limit: Number(opts.limit),
            offset: Number(opts.offset),
          }),
          {
            json: !!global.json,
            columns: [
              "id",
              "remoteNumber",
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
