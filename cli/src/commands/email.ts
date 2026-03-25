import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { Message, MessageDirection } from "@inkbox/sdk";

export function registerEmailCommands(program: Command): void {
  const email = program
    .command("email")
    .description("Email operations (identity-scoped)");

  email
    .command("send")
    .description("Send an email")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("--to <addresses>", "Comma-separated recipient addresses")
    .requiredOption("--subject <subject>", "Email subject")
    .option("--body-text <text>", "Plain text body")
    .option("--body-html <html>", "HTML body")
    .option("--cc <addresses>", "Comma-separated CC addresses")
    .option("--bcc <addresses>", "Comma-separated BCC addresses")
    .option("--in-reply-to <message-id>", "Message ID to reply to")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          to: string;
          subject: string;
          bodyText?: string;
          bodyHtml?: string;
          cc?: string;
          bcc?: string;
          inReplyTo?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.sendEmail({
          to: cmdOpts.to.split(",").map((s) => s.trim()),
          subject: cmdOpts.subject,
          bodyText: cmdOpts.bodyText,
          bodyHtml: cmdOpts.bodyHtml,
          cc: cmdOpts.cc?.split(",").map((s) => s.trim()),
          bcc: cmdOpts.bcc?.split(",").map((s) => s.trim()),
          inReplyToMessageId: cmdOpts.inReplyTo,
        });
        output(
          {
            id: msg.id,
            subject: msg.subject,
            to: msg.toAddresses.join(", "),
            status: msg.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  email
    .command("list")
    .description("List emails")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--direction <dir>", "Filter: inbound or outbound")
    .option("--limit <n>", "Max messages to show", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          direction?: string;
          limit: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const limit = parseInt(cmdOpts.limit, 10);
        const messages: Message[] = [];
        for await (const msg of identity.iterEmails({
          direction: cmdOpts.direction as MessageDirection | undefined,
        })) {
          messages.push(msg);
          if (messages.length >= limit) break;
        }
        output(messages, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "fromAddress",
            "subject",
            "isRead",
            "createdAt",
          ],
        });
      }),
    );

  email
    .command("get <message-id>")
    .description("Get a message with full body")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        messageId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.getMessage(messageId);
        output(
          {
            id: msg.id,
            threadId: msg.threadId,
            from: msg.fromAddress,
            to: msg.toAddresses.join(", "),
            subject: msg.subject,
            direction: msg.direction,
            isRead: msg.isRead,
            createdAt: msg.createdAt,
            bodyText: msg.bodyText,
          },
          { json: !!opts.json },
        );
      }),
    );

  email
    .command("search")
    .description("Search emails")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .requiredOption("-q, --query <query>", "Search query")
    .option("--limit <n>", "Max results", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          query: string;
          limit: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        if (!identity.mailbox) {
          console.error(
            `Identity '${cmdOpts.identity}' has no mailbox assigned.`,
          );
          process.exit(1);
        }
        const messages = await inkbox.mailboxes.search(
          identity.mailbox.emailAddress,
          { q: cmdOpts.query, limit: parseInt(cmdOpts.limit, 10) },
        );
        output(messages, {
          json: !!opts.json,
          columns: [
            "id",
            "direction",
            "fromAddress",
            "subject",
            "createdAt",
          ],
        });
      }),
    );
}
