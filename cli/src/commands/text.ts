import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerTextCommands(program: Command): void {
  const text = program
    .command("text")
    .description("Text message (SMS/MMS) operations (identity-scoped)");

  text
    .command("list")
    .description("List text messages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--unread-only", "Show only unread messages")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          limit: string;
          offset: string;
          unreadOnly?: boolean;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const texts = await identity.listTexts({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          isRead: cmdOpts.unreadOnly ? false : undefined,
        });
        output(texts, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "remotePhoneNumber",
            "type",
            "text",
            "isRead",
            "createdAt",
          ],
        });
      }),
    );

  text
    .command("get <text-id>")
    .description("Get a single text message")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        textId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.getText(textId);
        output(
          {
            id: msg.id,
            direction: msg.direction,
            local: msg.localPhoneNumber,
            remote: msg.remotePhoneNumber,
            type: msg.type,
            text: msg.text,
            isRead: msg.isRead,
            createdAt: msg.createdAt,
            media: msg.media,
          },
          { json: !!opts.json },
        );
      }),
    );

  text
    .command("conversations")
    .description("List conversation summaries")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const convos = await identity.listTextConversations({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(convos, {
          json: !!opts.json,
          columns: [
            "remotePhoneNumber",
            "latestText",
            "latestDirection",
            "unreadCount",
            "totalCount",
            "latestMessageAt",
          ],
        });
      }),
    );

  text
    .command("conversation <remote-number>")
    .description("Get messages in a conversation")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        remoteNumber: string,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msgs = await identity.getTextConversation(remoteNumber, {
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(msgs, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "remotePhoneNumber",
            "text",
            "type",
            "createdAt",
          ],
        });
      }),
    );

  text
    .command("search")
    .description("Full-text search across text messages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("-q, --query <query>", "Search query")
    .option("--limit <n>", "Max results", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; query: string; limit: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        if (!identity.phoneNumber) {
          console.error(
            `Identity '${cmdOpts.identity}' has no phone number assigned.`,
          );
          process.exit(1);
        }
        const results = await inkbox.texts.search(identity.phoneNumber.id, {
          q: cmdOpts.query,
          limit: parseInt(cmdOpts.limit, 10),
        });
        output(results, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "remotePhoneNumber",
            "text",
            "createdAt",
          ],
        });
      }),
    );

  text
    .command("mark-read <text-id>")
    .description("Mark a text message as read")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        textId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        await identity.markTextRead(textId);
        console.log(`Marked text ${textId} as read.`);
      }),
    );

  text
    .command("mark-conversation-read <remote-number>")
    .description("Mark all messages in a conversation as read")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        remoteNumber: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const result = await identity.markTextConversationRead(remoteNumber);
        console.log(
          `Marked ${result.updatedCount} message(s) in conversation with ${remoteNumber} as read.`,
        );
      }),
    );
}
