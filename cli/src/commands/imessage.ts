import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

const IMESSAGE_LIST_COLUMNS = [
  "id",
  "direction",
  "conversationId",
  "remoteNumber",
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
    .description("iMessage operations over shared pool numbers (identity-scoped)");

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
    .description(
      "Send an iMessage through an existing triage assignment. " +
        "The identity must be iMessage-enabled and already connected to the recipient.",
    )
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--to <number>", "E.164 recipient number")
    .option("--conversation-id <id>", "Existing conversation UUID to reply into")
    .option("--text <text>", "Message body")
    .option("--media-url <url>", "Media URL (at most one)")
    .option("--send-style <style>", "Expressive send style (e.g. slam, confetti)")
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
        if (cmdOpts.to && cmdOpts.conversationId) {
          console.error("Pass either --to or --conversation-id, not both.");
          process.exit(1);
        }
        if (!cmdOpts.to && !cmdOpts.conversationId) {
          console.error("Pass --to or --conversation-id.");
          process.exit(1);
        }
        if (!cmdOpts.text && !cmdOpts.mediaUrl) {
          console.error("Pass --text, --media-url, or both.");
          process.exit(1);
        }

        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.sendIMessage({
          to: cmdOpts.to,
          conversationId: cmdOpts.conversationId,
          text: cmdOpts.text,
          mediaUrls: cmdOpts.mediaUrl ? [cmdOpts.mediaUrl] : undefined,
          sendStyle: cmdOpts.sendStyle,
        });
        output(
          {
            id: msg.id,
            direction: msg.direction,
            remote: msg.remoteNumber,
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
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          conversationId?: string;
          limit: string;
          offset: string;
          unreadOnly?: boolean;
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
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string; limit: string; offset: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const convos = await identity.listIMessageConversations({
          limit: parseInt(cmdOpts.limit, 10),
          offset: parseInt(cmdOpts.offset, 10),
        });
        output(convos, {
          json: !!opts.json,
          columns: [
            "id",
            "remoteNumber",
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
    .description("Send a tapback reaction to a message")
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
    .description("Send a read receipt and mark a conversation's inbound messages read")
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
    .description("Show a typing indicator to a conversation's recipient")
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
