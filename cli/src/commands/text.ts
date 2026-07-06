import { Command } from "commander";
import type { AgentIdentity } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function formatPhoneList(value: string[] | null | undefined): string | undefined {
  return value?.join(", ");
}

type SendTextOptions = Parameters<AgentIdentity["sendText"]>[0];

export interface TextSendCommandOptions {
  identity: string;
  to?: string;
  conversationId?: string;
  text?: string;
  mediaUrl?: string[];
}

export function buildTextSendOptions(
  cmdOpts: TextSendCommandOptions,
): { sendOptions: SendTextOptions } | { error: string } {
  const recipients = cmdOpts.to ? parseList(cmdOpts.to) : [];
  const mediaUrls = cmdOpts.mediaUrl ?? [];
  if (recipients.length > 0 && cmdOpts.conversationId) {
    return { error: "Pass either --to or --conversation-id, not both." };
  }
  if (recipients.length === 0 && !cmdOpts.conversationId) {
    return { error: "Pass --to or --conversation-id." };
  }
  if (!cmdOpts.text && mediaUrls.length === 0) {
    return { error: "Pass --text, --media-url, or both." };
  }

  const sendOptions: SendTextOptions = {};
  if (recipients.length > 0) {
    sendOptions.to = recipients.length === 1 ? recipients[0] : recipients;
  }
  if (cmdOpts.conversationId) {
    sendOptions.conversationId = cmdOpts.conversationId;
  }
  if (cmdOpts.text) {
    sendOptions.text = cmdOpts.text;
  }
  if (mediaUrls.length > 0) {
    sendOptions.mediaUrls = mediaUrls;
  }
  return { sendOptions };
}

export function registerTextCommands(program: Command): void {
  const text = program
    .command("text")
    .description("Text message (SMS/MMS) operations (identity-scoped)");

  text
    .command("send")
    .description("Send an outbound SMS/MMS from this identity's phone number")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--to <numbers>", "Comma-separated E.164 destination number(s)")
    .option("--conversation-id <id>", "Existing conversation UUID to reply into")
    .option("--text <text>", "Message body")
    .option("--media-url <url>", "MMS media URL; repeat for multiple", collect, [])
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          to?: string;
          conversationId?: string;
          text?: string;
          mediaUrl: string[];
        },
      ) {
        const sendResult = buildTextSendOptions(cmdOpts);
        if ("error" in sendResult) {
          console.error(sendResult.error);
          process.exit(1);
        }

        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.sendText(sendResult.sendOptions);
        output(
          {
            id: msg.id,
            direction: msg.direction,
            local: msg.localPhoneNumber,
            remote: msg.remotePhoneNumber,
            conversationId: msg.conversationId,
            recipients: msg.recipients?.map((r) => r.recipientPhoneNumber).join(", "),
            text: msg.text,
            deliveryStatus: msg.deliveryStatus,
            createdAt: msg.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  text
    .command("list")
    .description("List text messages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--unread-only", "Show only unread messages")
    .option("--start-datetime <date>", "Only texts with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only texts with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          limit: string;
          offset: string;
          unreadOnly?: boolean;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const texts = await identity.listTexts({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          isRead: cmdOpts.unreadOnly ? false : undefined,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
        });
        output(texts, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "conversationId",
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
            conversationId: msg.conversationId,
            sender: msg.senderPhoneNumber,
            recipients: msg.recipients?.map((r) => r.recipientPhoneNumber).join(", "),
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
    .option("--include-groups", "Include group conversations")
    .option("--start-datetime <date>", "Only conversations with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only conversations with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          limit: string;
          offset: string;
          includeGroups?: boolean;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const convos = await identity.listTextConversations({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          includeGroups: !!cmdOpts.includeGroups,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
        });
        const rows = opts.json
          ? convos
          : convos.map((c) => ({
              ...c,
              participants: formatPhoneList(c.participants),
            }));
        output(rows, {
          json: !!opts.json,
          columns: [
            "id",
            "remotePhoneNumber",
            "participants",
            "isGroup",
            "latestHasMedia",
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
    .command("conversation <conversation-key>")
    .description("Get messages in a conversation")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        conversationKey: string,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msgs = await identity.getTextConversation(conversationKey, {
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(msgs, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "conversationId",
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
            "conversationId",
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
    .command("mark-conversation-read <conversation-key>")
    .description("Mark all messages in a conversation as read")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        conversationKey: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const result = await identity.markTextConversationRead(conversationKey);
        const displayKey = result.remotePhoneNumber ?? result.conversationId ?? conversationKey;
        console.log(
          `Marked ${result.updatedCount} message(s) in conversation ${displayKey} as read.`,
        );
      }),
    );
}
