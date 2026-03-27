import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { Message, MessageDirection, ThreadDetail } from "@inkbox/sdk";

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

  email
    .command("unread")
    .description("List unread emails")
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
        for await (const msg of identity.iterUnreadEmails({
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
            "createdAt",
          ],
        });
      }),
    );

  email
    .command("mark-read <message-ids...>")
    .description("Mark messages as read")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        messageIds: string[],
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        await identity.markEmailsRead(messageIds);
        console.log(`Marked ${messageIds.length} message(s) as read.`);
      }),
    );

  email
    .command("delete <message-id>")
    .description("Delete an email")
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
        if (!identity.mailbox) {
          console.error(
            `Identity '${cmdOpts.identity}' has no mailbox assigned.`,
          );
          process.exit(1);
        }
        await inkbox.messages.delete(
          identity.mailbox.emailAddress,
          messageId,
        );
        console.log(`Deleted message '${messageId}'.`);
      }),
    );

  email
    .command("delete-thread <thread-id>")
    .description("Delete an email thread and all its messages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        threadId: string,
        cmdOpts: { identity: string },
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
        await inkbox.threads.delete(
          identity.mailbox.emailAddress,
          threadId,
        );
        console.log(`Deleted thread '${threadId}'.`);
      }),
    );

  email
    .command("star <message-id>")
    .description("Star an email")
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
        if (!identity.mailbox) {
          console.error(
            `Identity '${cmdOpts.identity}' has no mailbox assigned.`,
          );
          process.exit(1);
        }
        const msg = await inkbox.messages.star(
          identity.mailbox.emailAddress,
          messageId,
        );
        output(
          {
            id: msg.id,
            subject: msg.subject,
            isStarred: msg.isStarred,
          },
          { json: !!opts.json },
        );
      }),
    );

  email
    .command("unstar <message-id>")
    .description("Unstar an email")
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
        if (!identity.mailbox) {
          console.error(
            `Identity '${cmdOpts.identity}' has no mailbox assigned.`,
          );
          process.exit(1);
        }
        const msg = await inkbox.messages.unstar(
          identity.mailbox.emailAddress,
          messageId,
        );
        output(
          {
            id: msg.id,
            subject: msg.subject,
            isStarred: msg.isStarred,
          },
          { json: !!opts.json },
        );
      }),
    );

  email
    .command("thread <thread-id>")
    .description("Get an email thread with all messages")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        threadId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const thread = await identity.getThread(threadId);
        if (opts.json) {
          output(thread, { json: true });
        } else {
          output(
            { id: thread.id, subject: thread.subject, messageCount: thread.messages.length },
            { json: false },
          );
          console.log("");
          output(thread.messages, {
            json: false,
            columns: [
              "id",
              "direction",
              "fromAddress",
              "subject",
              "isRead",
              "createdAt",
            ],
          });
        }
      }),
    );
}
