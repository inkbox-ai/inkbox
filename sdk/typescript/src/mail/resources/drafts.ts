import { HttpTransport, validateIdempotencyKey } from "../../_http.js";
import {
  DraftAttachmentContent,
  DraftDetail,
  DraftRecipients,
  DraftSummary,
  ForwardMode,
  MailAttachmentInput,
  Message,
  RawCursorPage,
  RawDraftDetail,
  RawDraftSummary,
  RawMessage,
  parseDraftDetail,
  parseDraftSummary,
  parseMessage,
} from "../types.js";

const DEFAULT_PAGE_SIZE = 50;

export interface CreateDraftOptions extends DraftRecipients {
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  replyTo?: string | null;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  references?: string[] | null;
  attachments?: MailAttachmentInput[] | null;
  trackOpens?: boolean;
  forwardMessageId?: string | null;
  forwardMode?: ForwardMode | "inline" | "wrapped";
  includeOriginalAttachments?: boolean;
  forwardNoteText?: string | null;
  forwardNoteHtml?: string | null;
  idempotencyKey?: string;
}

export interface UpdateDraftOptions {
  generation: number;
  recipients?: DraftRecipients | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  replyTo?: string | null;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  references?: string[] | null;
  trackOpens?: boolean;
  forwardNoteText?: string | null;
  forwardNoteHtml?: string | null;
}

function attachmentToWire(attachment: MailAttachmentInput): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    filename: attachment.filename,
    content_type: attachment.contentType,
    content_base64: attachment.contentBase64,
  };
  if (attachment.contentId !== undefined) wire["content_id"] = attachment.contentId;
  return wire;
}

function recipientsToWire(recipients: DraftRecipients): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  if (recipients.to !== undefined) wire["to"] = recipients.to;
  if (recipients.cc !== undefined) wire["cc"] = recipients.cc;
  if (recipients.bcc !== undefined) wire["bcc"] = recipients.bcc;
  return wire;
}

function setIfDefined(
  body: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined) body[key] = value;
}

function parseFilename(disposition: string | null): string {
  if (!disposition) return "attachment";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1]
    ?? disposition.match(/filename=([^;]+)/i)?.[1]?.trim()
    ?? "attachment";
}

export class DraftsResource {
  constructor(private readonly http: HttpTransport) {}

  async *list(
    emailAddress: string,
    options?: { pageSize?: number },
  ): AsyncGenerator<DraftSummary> {
    const limit = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    let cursor: string | undefined;
    while (true) {
      const page = await this.http.get<RawCursorPage<RawDraftSummary>>(
        `/mailboxes/${emailAddress}/drafts`,
        { limit, cursor },
      );
      for (const item of page.items) yield parseDraftSummary(item);
      if (!page.has_more) break;
      cursor = page.next_cursor ?? undefined;
      if (!cursor) break;
    }
  }

  async create(emailAddress: string, options: CreateDraftOptions = {}): Promise<DraftDetail> {
    const forwardOnlyKeys = [
      "forwardMode",
      "includeOriginalAttachments",
      "forwardNoteText",
      "forwardNoteHtml",
    ] as const;
    if (
      options.forwardMessageId == null
      && forwardOnlyKeys.some((key) => options[key] !== undefined)
    ) {
      throw new Error("forward options require forwardMessageId");
    }
    if (options.idempotencyKey !== undefined) validateIdempotencyKey(options.idempotencyKey);
    const body: Record<string, unknown> = {};
    if (options.to !== undefined || options.cc !== undefined || options.bcc !== undefined) {
      body["recipients"] = recipientsToWire(options);
    }
    setIfDefined(body, "subject", options.subject);
    setIfDefined(body, "body_text", options.bodyText);
    setIfDefined(body, "body_html", options.bodyHtml);
    setIfDefined(body, "reply_to", options.replyTo);
    setIfDefined(body, "thread_id", options.threadId);
    setIfDefined(body, "in_reply_to_message_id", options.inReplyToMessageId);
    setIfDefined(body, "references", options.references);
    if (options.attachments !== undefined) {
      body["attachments"] = options.attachments?.map(attachmentToWire) ?? null;
    }
    setIfDefined(body, "track_opens", options.trackOpens);
    setIfDefined(body, "forward_message_id", options.forwardMessageId);
    setIfDefined(body, "forward_mode", options.forwardMode);
    setIfDefined(body, "include_original_attachments", options.includeOriginalAttachments);
    setIfDefined(body, "forward_note_text", options.forwardNoteText);
    setIfDefined(body, "forward_note_html", options.forwardNoteHtml);
    const path = `/mailboxes/${emailAddress}/drafts`;
    const created = options.idempotencyKey === undefined
      ? await this.http.post<RawDraftDetail>(path, body)
      : await this.http.post<RawDraftDetail>(path, body, {
        headers: { "Idempotency-Key": options.idempotencyKey },
      });
    return parseDraftDetail(created);
  }

  async get(emailAddress: string, draftId: string): Promise<DraftDetail> {
    return parseDraftDetail(await this.http.get<RawDraftDetail>(
      `/mailboxes/${emailAddress}/drafts/${draftId}`,
    ));
  }

  async update(
    emailAddress: string,
    draftId: string,
    options: UpdateDraftOptions,
  ): Promise<DraftDetail> {
    const body: Record<string, unknown> = { generation: options.generation };
    if (options.recipients !== undefined) {
      body["recipients"] = options.recipients === null
        ? null
        : recipientsToWire(options.recipients);
    }
    setIfDefined(body, "subject", options.subject);
    setIfDefined(body, "body_text", options.bodyText);
    setIfDefined(body, "body_html", options.bodyHtml);
    setIfDefined(body, "reply_to", options.replyTo);
    setIfDefined(body, "thread_id", options.threadId);
    setIfDefined(body, "in_reply_to_message_id", options.inReplyToMessageId);
    setIfDefined(body, "references", options.references);
    setIfDefined(body, "track_opens", options.trackOpens);
    setIfDefined(body, "forward_note_text", options.forwardNoteText);
    setIfDefined(body, "forward_note_html", options.forwardNoteHtml);
    return parseDraftDetail(await this.http.patch<RawDraftDetail>(
      `/mailboxes/${emailAddress}/drafts/${draftId}`, body,
    ));
  }

  async duplicate(emailAddress: string, draftId: string, generation: number): Promise<DraftDetail> {
    return parseDraftDetail(await this.http.post<RawDraftDetail>(
      `/mailboxes/${emailAddress}/drafts/${draftId}/duplicate`, { generation },
    ));
  }

  async delete(emailAddress: string, draftId: string, generation: number): Promise<void> {
    await this.http.delete(`/mailboxes/${emailAddress}/drafts/${draftId}`, {
      params: { generation },
    });
  }

  async addAttachments(
    emailAddress: string,
    draftId: string,
    generation: number,
    attachments: MailAttachmentInput[],
  ): Promise<DraftDetail> {
    return parseDraftDetail(await this.http.post<RawDraftDetail>(
      `/mailboxes/${emailAddress}/drafts/${draftId}/attachments`,
      { generation, attachments: attachments.map(attachmentToWire) },
    ));
  }

  async removeAttachment(
    emailAddress: string,
    draftId: string,
    partIndex: number,
    generation: number,
  ): Promise<DraftDetail> {
    return parseDraftDetail(await this.http.deleteWithResponse<RawDraftDetail>(
      `/mailboxes/${emailAddress}/drafts/${draftId}/attachments/${partIndex}`,
      { params: { generation } },
    ));
  }

  async downloadAttachment(
    emailAddress: string,
    draftId: string,
    partIndex: number,
    generation: number,
  ): Promise<DraftAttachmentContent> {
    const response = await this.http.getBytes(
      `/mailboxes/${emailAddress}/drafts/${draftId}/attachments/${partIndex}`,
      { generation },
    );
    return {
      content: response.data,
      filename: parseFilename(response.headers.get("Content-Disposition")),
      contentType: response.headers.get("Content-Type")?.split(";", 1)[0]?.trim()
        || "application/octet-stream",
    };
  }

  async send(emailAddress: string, draftId: string, generation: number): Promise<Message> {
    return parseMessage(await this.http.post<RawMessage>(
      `/mailboxes/${emailAddress}/drafts/${draftId}/send`, { generation },
    ));
  }
}
