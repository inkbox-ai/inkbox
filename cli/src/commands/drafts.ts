import { writeFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import type {
  CreateDraftOptions,
  DraftDetail,
  DraftRecipients,
  DraftSummary,
  Inkbox,
  UpdateDraftOptions,
} from "@inkbox/sdk";
import { ForwardMode } from "@inkbox/sdk";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";
import { buildAttachments, collect } from "./email-attachments.js";

type DraftFields = {
  identity: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  trackOpens?: boolean;
  forwardNoteText?: string;
  forwardNoteHtml?: string;
};

type CreateOptions = DraftFields & {
  attach: string[];
  inlineImage: string[];
  forwardMessageId?: string;
  forwardMode?: string;
  includeOriginalAttachments?: boolean;
};

type UpdateOptions = DraftFields & {
  generation: number;
  clearRecipients?: boolean;
  clearSubject?: boolean;
  clearBodyText?: boolean;
  clearBodyHtml?: boolean;
  clearReplyTo?: boolean;
  clearThreadId?: boolean;
  clearInReplyTo?: boolean;
  clearReferences?: boolean;
  clearForwardNoteText?: boolean;
  clearForwardNoteHtml?: boolean;
};

function commaList(value: string | undefined): string[] | undefined {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function partIndex(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Part index must be a non-negative integer.");
  }
  return parsed;
}

async function resolveMailbox(inkbox: Inkbox, handle: string): Promise<string> {
  const identity = await inkbox.getIdentity(handle);
  if (!identity.mailbox) {
    throw new Error(`Identity '${handle}' has no mailbox assigned.`);
  }
  return identity.mailbox.emailAddress;
}

function validateForwardMode(mode: string | undefined): ForwardMode | undefined {
  if (mode === undefined) return undefined;
  if (mode !== ForwardMode.INLINE && mode !== ForwardMode.WRAPPED) {
    throw new Error("--forward-mode must be inline or wrapped.");
  }
  return mode;
}

function createOptions(options: CreateOptions): CreateDraftOptions {
  const isForward = options.forwardMessageId !== undefined;
  if (!isForward && (
    options.forwardMode !== undefined
    || options.includeOriginalAttachments !== undefined
    || options.forwardNoteText !== undefined
    || options.forwardNoteHtml !== undefined
  )) {
    throw new Error("Forward options require --forward-message-id.");
  }
  if (isForward && (
    options.bodyText !== undefined
    || options.bodyHtml !== undefined
    || options.threadId !== undefined
    || options.inReplyTo !== undefined
    || options.references !== undefined
  )) {
    throw new Error("Forward drafts use forward notes and cannot include reply fields.");
  }
  if (isForward && options.inlineImage.length > 0) {
    throw new Error("Forward drafts do not support --inline-image.");
  }
  if (!isForward && options.inlineImage.length > 0 && options.bodyHtml === undefined) {
    throw new Error("--inline-image requires --body-html.");
  }
  return {
    to: commaList(options.to),
    cc: commaList(options.cc),
    bcc: commaList(options.bcc),
    subject: options.subject,
    bodyText: options.bodyText,
    bodyHtml: options.bodyHtml,
    replyTo: options.replyTo,
    threadId: options.threadId,
    inReplyToMessageId: options.inReplyTo,
    references: commaList(options.references),
    attachments: buildAttachments(options.attach, options.inlineImage),
    trackOpens: options.trackOpens,
    forwardMessageId: options.forwardMessageId,
    forwardMode: validateForwardMode(options.forwardMode),
    includeOriginalAttachments: options.includeOriginalAttachments,
    forwardNoteText: options.forwardNoteText,
    forwardNoteHtml: options.forwardNoteHtml,
  };
}

function setNullable(
  target: Record<string, unknown>,
  key: string,
  value: string | string[] | undefined,
  clear: boolean | undefined,
  option: string,
): void {
  if (value !== undefined && clear) {
    throw new Error(`${option} and --clear-${option.slice(2)} cannot be combined.`);
  }
  if (value !== undefined) target[key] = value;
  else if (clear) target[key] = null;
}

export function buildUpdateOptions(options: UpdateOptions): UpdateDraftOptions {
  const update: Record<string, unknown> = { generation: options.generation };
  const recipientValues = {
    to: commaList(options.to),
    cc: commaList(options.cc),
    bcc: commaList(options.bcc),
  };
  const hasRecipientFields = Object.values(recipientValues).some(
    (value) => value !== undefined,
  );
  if (options.clearRecipients && hasRecipientFields) {
    throw new Error("--clear-recipients cannot be combined with recipient options.");
  }
  if (options.clearRecipients) {
    update.recipients = null;
  } else if (hasRecipientFields) {
    const recipients: Record<string, unknown> = {};
    if (recipientValues.to !== undefined) recipients.to = recipientValues.to;
    if (recipientValues.cc !== undefined) recipients.cc = recipientValues.cc;
    if (recipientValues.bcc !== undefined) recipients.bcc = recipientValues.bcc;
    update.recipients = recipients as DraftRecipients;
  }
  setNullable(update, "subject", options.subject, options.clearSubject, "--subject");
  setNullable(update, "bodyText", options.bodyText, options.clearBodyText, "--body-text");
  setNullable(update, "bodyHtml", options.bodyHtml, options.clearBodyHtml, "--body-html");
  setNullable(update, "replyTo", options.replyTo, options.clearReplyTo, "--reply-to");
  setNullable(update, "threadId", options.threadId, options.clearThreadId, "--thread-id");
  setNullable(update, "inReplyToMessageId", options.inReplyTo, options.clearInReplyTo, "--in-reply-to");
  setNullable(
    update,
    "references",
    commaList(options.references),
    options.clearReferences,
    "--references",
  );
  setNullable(
    update,
    "forwardNoteText",
    options.forwardNoteText,
    options.clearForwardNoteText,
    "--forward-note-text",
  );
  setNullable(
    update,
    "forwardNoteHtml",
    options.forwardNoteHtml,
    options.clearForwardNoteHtml,
    "--forward-note-html",
  );
  if (options.trackOpens !== undefined) update.trackOpens = options.trackOpens;
  if (Object.keys(update).length === 1) {
    throw new Error("Pass at least one field to update or clear.");
  }
  return update as unknown as UpdateDraftOptions;
}

function printDraft(draft: DraftDetail, json: boolean): void {
  output(draft, { json });
}

function addDraftFieldOptions(command: Command): Command {
  return command
    .option("--to <addresses>", "Comma-separated To addresses")
    .option("--cc <addresses>", "Comma-separated CC addresses")
    .option("--bcc <addresses>", "Comma-separated BCC addresses")
    .option("--subject <subject>", "Email subject")
    .option("--body-text <text>", "Plain text body")
    .option("--body-html <html>", "HTML body")
    .option("--reply-to <address>", "Reply-To address")
    .option("--thread-id <thread-id>", "Thread ID")
    .option("--in-reply-to <message-id>", "Message ID being replied to")
    .option("--references <message-ids>", "Comma-separated message IDs")
    .option("--track-opens", "Enable open tracking")
    .option("--no-track-opens", "Disable open tracking")
    .option("--forward-note-text <text>", "Plain text note for a forward")
    .option("--forward-note-html <html>", "HTML note for a forward");
}

function addClearOptions(command: Command): Command {
  return command
    .option("--clear-recipients", "Clear To, CC, and BCC")
    .option("--clear-subject", "Clear the subject")
    .option("--clear-body-text", "Clear the plain text body")
    .option("--clear-body-html", "Clear the HTML body")
    .option("--clear-reply-to", "Clear the Reply-To address")
    .option("--clear-thread-id", "Clear the thread ID")
    .option("--clear-in-reply-to", "Clear the reply message ID")
    .option("--clear-references", "Clear message references")
    .option("--clear-forward-note-text", "Clear the plain text forward note")
    .option("--clear-forward-note-html", "Clear the HTML forward note");
}

function generationCommand(command: Command): Command {
  return command.requiredOption(
    "--generation <n>",
    "Current draft generation",
    positiveInteger,
  );
}

export function registerDraftCommands(email: Command): void {
  const drafts = email.command("drafts").description("Manage email drafts");

  drafts
    .command("list")
    .description("List drafts")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .option("--limit <n>", "Max drafts to show", positiveInteger, 50)
    .action(withErrorHandler(async function (
      this: Command,
      options: { identity: string; limit: number },
    ) {
      const global = getGlobalOpts(this);
      const inkbox = createClient(global);
      const mailbox = await resolveMailbox(inkbox, options.identity);
      const items: DraftSummary[] = [];
      for await (const draft of inkbox.drafts.list(mailbox, { pageSize: options.limit })) {
        items.push(draft);
        if (items.length >= options.limit) break;
      }
      if (global.json) {
        output(items, { json: true });
      } else {
        output(items.map((draft) => ({
          id: draft.id,
          to: draft.toAddresses.join(", "),
          subject: draft.subject,
          attachments: draft.attachmentCount,
          generation: draft.generation,
          updatedAt: draft.updatedAt,
        })), {
          json: false,
          columns: ["id", "to", "subject", "attachments", "generation", "updatedAt"],
        });
      }
    }));

  const create = addDraftFieldOptions(
    drafts
      .command("create")
      .description("Create a draft")
      .requiredOption("-i, --identity <handle>", "Agent identity handle"),
  )
    .option("--attach <path>", "Attach a file (repeatable)", collect, [])
    .option(
      "--inline-image <cid=path>",
      "Embed an inline image referenced as cid:<cid> (repeatable)",
      collect,
      [],
    )
    .option("--forward-message-id <message-id>", "Message ID to forward")
    .option("--forward-mode <mode>", "Forward mode: inline or wrapped")
    .option("--include-original-attachments", "Include original attachments")
    .option("--no-include-original-attachments", "Exclude original attachments");
  create.action(withErrorHandler(async function (this: Command, options: CreateOptions) {
    const draftOptions = createOptions(options);
    const global = getGlobalOpts(this);
    const inkbox = createClient(global);
    const mailbox = await resolveMailbox(inkbox, options.identity);
    printDraft(await inkbox.drafts.create(mailbox, draftOptions), !!global.json);
  }));

  drafts
    .command("get <draft-id>")
    .description("Get a draft")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(withErrorHandler(async function (
      this: Command,
      draftId: string,
      options: { identity: string },
    ) {
      const global = getGlobalOpts(this);
      const inkbox = createClient(global);
      const mailbox = await resolveMailbox(inkbox, options.identity);
      printDraft(await inkbox.drafts.get(mailbox, draftId), !!global.json);
    }));

  const update = addClearOptions(addDraftFieldOptions(generationCommand(
    drafts
      .command("update <draft-id>")
      .description("Update a draft")
      .requiredOption("-i, --identity <handle>", "Agent identity handle"),
  )));
  update.addHelpText(
    "after",
    "\nSupplying any recipient option replaces all To, CC, and BCC values.",
  );
  update.action(withErrorHandler(async function (
    this: Command,
    draftId: string,
    options: UpdateOptions,
  ) {
    const updateOptions = buildUpdateOptions(options);
    const global = getGlobalOpts(this);
    const inkbox = createClient(global);
    const mailbox = await resolveMailbox(inkbox, options.identity);
    printDraft(
      await inkbox.drafts.update(mailbox, draftId, updateOptions),
      !!global.json,
    );
  }));

  for (const [name, description] of [
    ["duplicate", "Duplicate a draft"],
    ["send", "Send a draft"],
    ["delete", "Delete a draft"],
  ] as const) {
    generationCommand(
      drafts
        .command(`${name} <draft-id>`)
        .description(description)
        .requiredOption("-i, --identity <handle>", "Agent identity handle"),
    ).action(withErrorHandler(async function (
      this: Command,
      draftId: string,
      options: { identity: string; generation: number },
    ) {
      const global = getGlobalOpts(this);
      const inkbox = createClient(global);
      const mailbox = await resolveMailbox(inkbox, options.identity);
      if (name === "duplicate") {
        printDraft(
          await inkbox.drafts.duplicate(mailbox, draftId, options.generation),
          !!global.json,
        );
      } else if (name === "send") {
        const message = await inkbox.drafts.send(mailbox, draftId, options.generation);
        output({
          id: message.id,
          subject: message.subject,
          to: message.toAddresses.join(", "),
          status: message.status,
        }, { json: !!global.json });
      } else {
        await inkbox.drafts.delete(mailbox, draftId, options.generation);
        output(
          { deleted: true, id: draftId, generation: options.generation },
          { json: !!global.json },
        );
      }
    }));
  }

  const attachment = drafts.command("attachment").description("Manage draft attachments");

  generationCommand(
    attachment
      .command("add <draft-id>")
      .description("Add attachments to a draft")
      .requiredOption("-i, --identity <handle>", "Agent identity handle"),
  )
    .option("--attach <path>", "Attach a file (repeatable)", collect, [])
    .action(withErrorHandler(async function (
      this: Command,
      draftId: string,
      options: {
        identity: string;
        generation: number;
        attach: string[];
      },
    ) {
      const attachments = buildAttachments(options.attach, []);
      if (!attachments) throw new Error("Pass at least one --attach path.");
      const global = getGlobalOpts(this);
      const inkbox = createClient(global);
      const mailbox = await resolveMailbox(inkbox, options.identity);
      printDraft(
        await inkbox.drafts.addAttachments(mailbox, draftId, options.generation, attachments),
        !!global.json,
      );
    }));

  generationCommand(
    attachment
      .command("remove <draft-id> <part-index>")
      .description("Remove an attachment from a draft")
      .requiredOption("-i, --identity <handle>", "Agent identity handle"),
  ).action(withErrorHandler(async function (
    this: Command,
    draftId: string,
    index: string,
    options: { identity: string; generation: number },
  ) {
    const parsedIndex = partIndex(index);
    const global = getGlobalOpts(this);
    const inkbox = createClient(global);
    const mailbox = await resolveMailbox(inkbox, options.identity);
    printDraft(
      await inkbox.drafts.removeAttachment(
        mailbox,
        draftId,
        parsedIndex,
        options.generation,
      ),
      !!global.json,
    );
  }));

  generationCommand(
    attachment
      .command("download <draft-id> <part-index>")
      .description("Download an attachment from a draft")
      .requiredOption("-i, --identity <handle>", "Agent identity handle")
      .requiredOption("--output <path>", "Output file path"),
  ).action(withErrorHandler(async function (
    this: Command,
    draftId: string,
    index: string,
    options: { identity: string; generation: number; output: string },
  ) {
    const parsedIndex = partIndex(index);
    const global = getGlobalOpts(this);
    const inkbox = createClient(global);
    const mailbox = await resolveMailbox(inkbox, options.identity);
    const downloaded = await inkbox.drafts.downloadAttachment(
      mailbox,
      draftId,
      parsedIndex,
      options.generation,
    );
    writeFileSync(options.output, downloaded.content);
    output({
      output: options.output,
      filename: downloaded.filename,
      contentType: downloaded.contentType,
      size: downloaded.content.byteLength,
    }, { json: !!global.json });
  }));
}
