import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import type { AgentIdentity } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

const IMESSAGE_LIST_COLUMNS = [
  "id",
  "direction",
  "conversationId",
  "remoteNumber",
  "senderNumber",
  "participants",
  "isGroup",
  "service",
  "content",
  "isRead",
  "createdAt",
];

const CONTACT_RULE_COLUMNS = [
  "id",
  "agentIdentityId",
  "action",
  "matchType",
  "matchTarget",
  "status",
  "createdAt",
];

type SendIMessageOptions = Parameters<AgentIdentity["sendIMessage"]>[0];

export interface IMessageSendCommandOptions {
  identity: string;
  to?: string;
  conversationId?: string;
  text?: string;
  mediaUrl?: string;
  sendStyle?: string;
}

export function buildIMessageSendOptions(
  cmdOpts: IMessageSendCommandOptions,
): { sendOptions: SendIMessageOptions } | { error: string } {
  const recipients = (cmdOpts.to ?? "")
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  if (recipients.length > 0 && cmdOpts.conversationId) {
    return { error: "Pass either --to or --conversation-id, not both." };
  }
  if (recipients.length === 0 && !cmdOpts.conversationId) {
    return { error: "Pass --to or --conversation-id." };
  }
  if (!cmdOpts.text && !cmdOpts.mediaUrl) {
    return { error: "Pass --text, --media-url, or both." };
  }
  const sendOptions: SendIMessageOptions = {};
  if (recipients.length > 0) {
    sendOptions.to = recipients.length === 1 ? recipients[0] : recipients;
  }
  if (cmdOpts.conversationId) sendOptions.conversationId = cmdOpts.conversationId;
  if (cmdOpts.text) sendOptions.text = cmdOpts.text;
  if (cmdOpts.mediaUrl) sendOptions.mediaUrls = [cmdOpts.mediaUrl];
  if (cmdOpts.sendStyle) sendOptions.sendStyle = cmdOpts.sendStyle;
  return { sendOptions };
}

function registerContactRuleCommands(parent: Command): void {
  const rule = parent
    .command("contact-rule")
    .description("Manage per-identity iMessage allow/block rules");

  rule
    .command("list")
    .description("List iMessage contact rules for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--action <action>", "Filter by 'allow' or 'block'")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; action?: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rules = await inkbox.imessageContactRules.list(cmdOpts.identity, {
          action: cmdOpts.action as never,
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(rules, { json: !!opts.json, columns: CONTACT_RULE_COLUMNS });
      }),
    );

  rule
    .command("create")
    .description("Create an iMessage contact rule for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--action <action>", "'allow' or 'block'")
    .requiredOption("--match-target <number>", "Phone number to match (E.164)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; action: string; matchTarget: string },
      ) {
        if (cmdOpts.action !== "allow" && cmdOpts.action !== "block") {
          throw new Error("--action must be 'allow' or 'block'");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.imessageContactRules.create(cmdOpts.identity, {
          action: cmdOpts.action as never,
          matchTarget: cmdOpts.matchTarget,
        });
        output(row, { json: !!opts.json });
      }),
    );

  rule
    .command("update <rule-id>")
    .description("Update an iMessage contact rule's action or status (admin-only)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--action <action>", "'allow' or 'block'")
    .option("--status <status>", "'active' or 'paused'")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { identity: string; action?: string; status?: string },
      ) {
        if (cmdOpts.action !== undefined && cmdOpts.action !== "allow" && cmdOpts.action !== "block") {
          throw new Error("--action must be 'allow' or 'block'");
        }
        if (cmdOpts.status !== undefined && cmdOpts.status !== "active" && cmdOpts.status !== "paused") {
          throw new Error("--status must be 'active' or 'paused'");
        }
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const row = await inkbox.imessageContactRules.update(
          cmdOpts.identity,
          ruleId,
          {
            action: cmdOpts.action as never,
            status: cmdOpts.status as never,
          },
        );
        output(row, { json: !!opts.json });
      }),
    );

  rule
    .command("delete <rule-id>")
    .description("Delete an iMessage contact rule (admin-only)")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        ruleId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.imessageContactRules.delete(cmdOpts.identity, ruleId);
        console.log(`Deleted iMessage contact rule '${ruleId}'.`);
      }),
    );

  rule
    .command("list-all")
    .description("Org-wide list of iMessage contact rules (admin-only)")
    .option("--agent-identity-id <id>", "Narrow to one agent identity by id")
    .option("--action <action>", "Filter by 'allow' or 'block'")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          agentIdentityId?: string;
          action?: string;
          limit: string;
          offset: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rules = await inkbox.imessageContactRules.listAll({
          agentIdentityId: cmdOpts.agentIdentityId,
          action: cmdOpts.action as never,
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(rules, { json: !!opts.json, columns: CONTACT_RULE_COLUMNS });
      }),
    );
}

export function registerIMessageCommands(program: Command): void {
  const imessage = program
    .command("imessage")
    .description("iMessage operations (identity-scoped)");

  imessage
    .command("triage-number")
    .description("Show the iMessage router number and the command humans text to connect")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const triage = await inkbox.imessages.getTriageNumber();
        output(
          {
            number: triage.number,
            connectCommand: triage.connectCommand,
          },
          { json: !!opts.json },
        );
      }),
    );

  imessage
    .command("send")
    .description("Send an iMessage or reply to an existing conversation")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--to <numbers>", "One E.164 recipient or a comma-separated group")
    .option("--conversation-id <id>", "Existing conversation UUID to reply into")
    .option("--text <text>", "Message body")
    .option("--media-url <url>", "Media URL (at most one)")
    .option(
      "--send-style <style>",
      "Expressive style for one-to-one or group sends (e.g. slam, confetti)",
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          to?: string;
          conversationId?: string;
          text?: string;
          mediaUrl?: string;
          sendStyle?: string;
        },
      ) {
        const sendResult = buildIMessageSendOptions(cmdOpts);
        if ("error" in sendResult) {
          console.error(sendResult.error);
          process.exit(1);
        }

        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.sendIMessage(sendResult.sendOptions);
        output(
          {
            id: msg.id,
            direction: msg.direction,
            remote: msg.remoteNumber,
            sender: msg.senderNumber,
            participants: msg.participants?.join(", "),
            isGroup: msg.isGroup,
            conversationId: msg.conversationId,
            service: msg.service,
            content: msg.content,
            status: msg.status,
            createdAt: msg.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  imessage
    .command("list")
    .description("List iMessages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--conversation-id <id>", "Narrow to one conversation")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .option("--unread-only", "Show only unread messages")
    .option("--include-groups", "Include group messages")
    .option("--start-datetime <date>", "Only messages with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only messages with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          conversationId?: string;
          limit: string;
          offset: string;
          unreadOnly?: boolean;
          includeGroups?: boolean;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msgs = await identity.listIMessages({
          conversationId: cmdOpts.conversationId,
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          isRead: cmdOpts.unreadOnly ? false : undefined,
          includeGroups: cmdOpts.includeGroups,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
        });
        output(msgs, { json: !!opts.json, columns: IMESSAGE_LIST_COLUMNS });
      }),
    );

  imessage
    .command("assignments")
    .description("List recipients actively connected to this identity (newest first)")
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
        const rows = await identity.listIMessageAssignments({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(rows, {
          json: !!opts.json,
          columns: ["id", "remoteNumber", "status", "createdAt"],
        });
      }),
    );

  imessage
    .command("conversations")
    .description("List iMessage conversation summaries")
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
        const convos = await identity.listIMessageConversations({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
          includeGroups: cmdOpts.includeGroups,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
        });
        output(convos, {
          json: !!opts.json,
          columns: [
            "id",
            "remoteNumber",
            "participants",
            "isGroup",
            "groupCreationStatus",
            "latestText",
            "latestDirection",
            "latestHasMedia",
            "unreadCount",
            "totalCount",
            "latestMessageAt",
          ],
        });
      }),
    );

  imessage
    .command("conversation <conversation-id>")
    .description("Get messages in an iMessage conversation")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Pagination offset", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        conversationId: string,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msgs = await identity.listIMessages({
          conversationId,
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(msgs, { json: !!opts.json, columns: IMESSAGE_LIST_COLUMNS });
      }),
    );

  imessage
    .command("react <message-id>")
    .description("React to an inbound one-to-one or group message")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption(
      "--reaction <kind>",
      "Tapback kind: love, like, dislike, laugh, emphasize, question",
    )
    .option("--part-index <n>", "Part of a multi-part message to react to", "0")
    .action(
      withErrorHandler(async function (
        this: Command,
        messageId: string,
        cmdOpts: { identity: string; reaction: string; partIndex: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const reaction = await identity.sendIMessageReaction({
          messageId,
          reaction: cmdOpts.reaction,
          partIndex: parseInt(cmdOpts.partIndex, 10),
        });
        output(
          {
            id: reaction.id,
            assignmentId: reaction.assignmentId,
            reaction: reaction.reaction,
            targetMessageId: reaction.targetMessageId,
            conversationId: reaction.conversationId,
            createdAt: reaction.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  imessage
    .command("mark-conversation-read <conversation-id>")
    .description("Send a one-to-one read receipt and mark inbound messages read")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        conversationId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const result = await identity.markIMessageConversationRead(conversationId);
        console.log(
          `Marked ${result.updatedCount} message(s) in conversation ${result.conversationId} as read.`,
        );
      }),
    );

  imessage
    .command("typing <conversation-id>")
    .description("Show a typing indicator to a one-to-one recipient")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        conversationId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        await identity.sendIMessageTyping(conversationId);
        console.log(`Sent typing indicator for conversation ${conversationId}.`);
      }),
    );

  imessage
    .command("upload-media <file>")
    .description("Upload a media file (max 10 MiB) and print a URL usable with 'imessage send --media-url'")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--content-type <type>", "MIME type of the file")
    .action(
      withErrorHandler(async function (
        this: Command,
        file: string,
        cmdOpts: { identity: string; contentType?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const content = await readFile(file);
        const upload = await identity.uploadIMessageMedia({
          content: new Uint8Array(content),
          filename: basename(file),
          contentType: cmdOpts.contentType,
        });
        output(
          {
            mediaUrl: upload.mediaUrl,
            contentType: upload.contentType,
            size: upload.size,
          },
          { json: !!opts.json },
        );
      }),
    );

  registerContactRuleCommands(imessage);
}
