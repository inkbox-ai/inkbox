import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { Message, MessageDirection, ThreadDetail } from "@inkbox/sdk";
import { ForwardMode } from "@inkbox/sdk";

type AttachmentInput = {
  filename: string;
  contentType: string;
  contentBase64: string;
  contentId?: string;
};

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".json": "application/json",
  ".zip": "application/zip",
};

/** Accumulate a repeatable Commander option into an array. */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** MIME type inferred from a file extension, defaulting to octet-stream. */
export function contentTypeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Split a "<cid>=<path>" inline-image spec. Throws on malformed input. */
export function parseInlineImageSpec(spec: string): { cid: string; path: string } {
  const eq = spec.indexOf("=");
  if (eq <= 0 || eq === spec.length - 1) {
    throw new Error(`--inline-image must be <cid>=<path>, got: ${spec}`);
  }
  return { cid: spec.slice(0, eq).trim(), path: spec.slice(eq + 1).trim() };
}

/** Read a file into an SDK attachment; set contentId to embed it inline (cid:). */
function fileToAttachment(path: string, contentId?: string): AttachmentInput {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    console.error(`Cannot read attachment file: ${path}`);
    process.exit(1);
  }
  const att: AttachmentInput = {
    filename: basename(path),
    contentType: contentTypeForPath(path),
    contentBase64: buf.toString("base64"),
  };
  if (contentId !== undefined) att.contentId = contentId;
  return att;
}

/** Build the attachments array from --attach paths and --inline-image cid=path specs. */
function buildAttachments(attach: string[], inlineImage: string[]): AttachmentInput[] | undefined {
  const attachments = attach.map((p) => fileToAttachment(p));
  for (const spec of inlineImage) {
    let parsed: { cid: string; path: string };
    try {
      parsed = parseInlineImageSpec(spec);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    const att = fileToAttachment(parsed.path, parsed.cid);
    if (!att.contentType.startsWith("image/")) {
      console.error(
        `--inline-image ${parsed.cid} must be an image; got ${att.contentType} for ${parsed.path}.`,
      );
      process.exit(1);
    }
    attachments.push(att);
  }
  return attachments.length > 0 ? attachments : undefined;
}

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
    .option("--track-opens", "Embed an open-tracking pixel (requires --body-html)")
    .option("--attach <path>", "Attach a file (repeatable)", collect, [])
    .option(
      "--inline-image <cid=path>",
      "Embed an image inline in the HTML body, referenced as cid:<cid> (repeatable)",
      collect,
      [],
    )
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
          trackOpens?: boolean;
          attach: string[];
          inlineImage: string[];
        },
      ) {
        const opts = getGlobalOpts(this);
        if (cmdOpts.trackOpens && !cmdOpts.bodyHtml) {
          console.error("--track-opens requires --body-html.");
          process.exit(1);
        }
        if (cmdOpts.inlineImage.length > 0 && !cmdOpts.bodyHtml) {
          console.error("--inline-image requires --body-html (reference it as cid:<cid>).");
          process.exit(1);
        }
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
          trackOpens: cmdOpts.trackOpens,
          attachments: buildAttachments(cmdOpts.attach, cmdOpts.inlineImage),
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
    .command("reply-all <message-id>")
    .description("Reply to everyone on an existing email")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--subject <subject>", "Override subject")
    .option("--body-text <text>", "Plain text body")
    .option("--body-html <html>", "HTML body")
    .option("--reply-to <address>", "Reply-To address")
    .option("--attach <path>", "Attach a file (repeatable)", collect, [])
    .option(
      "--inline-image <cid=path>",
      "Embed an image inline in the HTML body, referenced as cid:<cid> (repeatable)",
      collect,
      [],
    )
    .action(
      withErrorHandler(async function (
        this: Command,
        messageId: string,
        cmdOpts: {
          identity: string;
          subject?: string;
          bodyText?: string;
          bodyHtml?: string;
          replyTo?: string;
          attach: string[];
          inlineImage: string[];
        },
      ) {
        const opts = getGlobalOpts(this);
        if (cmdOpts.inlineImage.length > 0 && !cmdOpts.bodyHtml) {
          console.error("--inline-image requires --body-html (reference it as cid:<cid>).");
          process.exit(1);
        }
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const msg = await identity.replyAllEmail(messageId, {
          subject: cmdOpts.subject,
          bodyText: cmdOpts.bodyText,
          bodyHtml: cmdOpts.bodyHtml,
          replyTo: cmdOpts.replyTo,
          attachments: buildAttachments(cmdOpts.attach, cmdOpts.inlineImage),
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
    .command("forward <message-id>")
    .description("Forward an existing email")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--to <addresses>", "Comma-separated recipient addresses")
    .option("--cc <addresses>", "Comma-separated CC addresses")
    .option("--bcc <addresses>", "Comma-separated BCC addresses")
    .option(
      "--mode <mode>",
      "Forward mode: 'inline' (default) or 'wrapped'",
      "inline",
    )
    .option("--subject <subject>", "Override subject (default: 'Fwd: <orig>')")
    .option("--body-text <text>", "Plain text caller note")
    .option("--body-html <html>", "HTML caller note")
    .option(
      "--no-include-original-attachments",
      "Drop the original attachments (inline mode only)",
    )
    .option("--reply-to <address>", "Reply-To address for the forward")
    .option("--track-opens", "Embed an open-tracking pixel (inline forwards can reuse the original's HTML)")
    .option("--attach <path>", "Attach an additional file alongside the forward (repeatable)", collect, [])
    .action(
      withErrorHandler(async function (
        this: Command,
        messageId: string,
        cmdOpts: {
          identity: string;
          to?: string;
          cc?: string;
          bcc?: string;
          mode: string;
          subject?: string;
          bodyText?: string;
          bodyHtml?: string;
          includeOriginalAttachments: boolean;
          replyTo?: string;
          trackOpens?: boolean;
          attach: string[];
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        if (!cmdOpts.to && !cmdOpts.cc && !cmdOpts.bcc) {
          console.error(
            "At least one of --to, --cc, or --bcc is required.",
          );
          process.exit(1);
        }
        // No client-side --body-html guard here: inline forwards inherit the
        // original's HTML, so trackability is only known server-side (422 if none).
        const split = (s: string | undefined) =>
          s?.split(",").map((x) => x.trim());
        const msg = await identity.forwardEmail(messageId, {
          to: split(cmdOpts.to),
          cc: split(cmdOpts.cc),
          bcc: split(cmdOpts.bcc),
          mode: cmdOpts.mode as ForwardMode,
          subject: cmdOpts.subject,
          bodyText: cmdOpts.bodyText,
          bodyHtml: cmdOpts.bodyHtml,
          additionalAttachments: buildAttachments(cmdOpts.attach, []),
          includeOriginalAttachments: cmdOpts.includeOriginalAttachments,
          replyTo: cmdOpts.replyTo,
          trackOpens: cmdOpts.trackOpens,
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
    .option("--start-datetime <date>", "Only emails with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only emails with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          direction?: string;
          limit: string;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const limit = parseInt(cmdOpts.limit, 10);
        const messages: Message[] = [];
        for await (const msg of identity.iterEmails({
          direction: cmdOpts.direction as MessageDirection | undefined,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
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
            "openCount",
            "firstOpenedAt",
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
            openCount: msg.openCount,
            firstOpenedAt: msg.firstOpenedAt,
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
            "openCount",
            "firstOpenedAt",
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
    .option("--start-datetime <date>", "Only emails with created_at >= this date/instant")
    .option("--end-datetime <date>", "Only emails with created_at <= this date (bare date is whole-day inclusive)")
    .option("--tz <zone>", "IANA timezone for bare/zone-less dates (default UTC)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          identity: string;
          direction?: string;
          limit: string;
          startDatetime?: string;
          endDatetime?: string;
          tz?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const limit = parseInt(cmdOpts.limit, 10);
        const messages: Message[] = [];
        for await (const msg of identity.iterUnreadEmails({
          direction: cmdOpts.direction as MessageDirection | undefined,
          startDatetime: cmdOpts.startDatetime,
          endDatetime: cmdOpts.endDatetime,
          tz: cmdOpts.tz,
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
            "openCount",
            "firstOpenedAt",
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
    .command("mark-unread <message-ids...>")
    .description("Mark messages as unread")
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
        await identity.markEmailsUnread(messageIds);
        console.log(`Marked ${messageIds.length} message(s) as unread.`);
      }),
    );

  email
    .command("download-attachment <message-id> <filename>")
    .description("Get a time-limited download URL for a message attachment")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        messageId: string,
        filename: string,
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
        const att = await inkbox.messages.getAttachment(
          identity.mailbox.emailAddress,
          messageId,
          filename,
        );
        output(
          { url: att.url, filename: att.filename, expiresIn: att.expiresIn },
          { json: !!opts.json },
        );
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
              "openCount",
              "firstOpenedAt",
              "createdAt",
            ],
          });
        }
      }),
    );
}
