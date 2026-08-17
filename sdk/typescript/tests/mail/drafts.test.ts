import { describe, expect, it, vi } from "vitest";
import { InkboxAPIError } from "../../src/_http.js";
import type { HttpTransport } from "../../src/_http.js";
import { DraftSendState, DraftsResource, ForwardMode } from "../../src/index.js";
import {
  parseDraftDetail,
  parseDraftSummary,
} from "../../src/mail/types.js";
import { RAW_MESSAGE } from "../sampleData.js";

const ADDRESS = "agent@example.com";
const DRAFT_ID = "11111111-1111-1111-1111-111111111111";

const RAW_SUMMARY = {
  id: DRAFT_ID,
  mailbox_id: "22222222-2222-2222-2222-222222222222",
  from_address: ADDRESS,
  to_addresses: ["to@example.com"],
  cc_addresses: [],
  bcc_addresses: ["bcc@example.com"],
  subject: "Draft subject",
  snippet: "Draft body",
  has_attachments: true,
  attachment_count: 1,
  generation: 4,
  send_state: "draft",
  track_opens: false,
  created_at: "2026-08-17T10:00:00Z",
  updated_at: "2026-08-17T11:00:00Z",
};

const RAW_DETAIL = {
  ...RAW_SUMMARY,
  body_text: "Draft body",
  body_html: null,
  reply_to: null,
  thread_id: null,
  message_id: "<draft@example.com>",
  in_reply_to: null,
  references: [],
  forward_source_message_id: null,
  forward_note_text: null,
  forward_note_html: null,
  attachment_metadata: [{
    part_index: 2,
    filename: "report 1.txt",
    content_type: "text/plain",
    size: 3,
    content_id: null,
    is_inline: false,
  }],
};

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    deleteWithResponse: vi.fn(),
    getBytes: vi.fn(),
  } as unknown as HttpTransport;
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

describe("draft parsers", () => {
  it("parses summaries and details into camelCase values", () => {
    const summary = parseDraftSummary(RAW_SUMMARY);
    const detail = parseDraftDetail(RAW_DETAIL);

    expect(summary.sendState).toBe(DraftSendState.DRAFT);
    expect(summary.updatedAt).toEqual(new Date("2026-08-17T11:00:00Z"));
    expect(detail.forwardSourceMessageId).toBeNull();
    expect(detail.attachmentMetadata[0]).toEqual({
      partIndex: 2,
      filename: "report 1.txt",
      contentType: "text/plain",
      size: 3,
      contentId: null,
      isInline: false,
    });
  });
});

describe("DraftsResource", () => {
  it("lists all cursor pages with the requested page size", async () => {
    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce({ items: [RAW_SUMMARY], next_cursor: "next", has_more: true })
      .mockResolvedValueOnce({ items: [{ ...RAW_SUMMARY, id: "second" }], next_cursor: null, has_more: false });

    const drafts = await collect(new DraftsResource(http).list(ADDRESS, { pageSize: 12 }));

    expect(drafts.map((draft) => draft.id)).toEqual([DRAFT_ID, "second"]);
    expect(http.get).toHaveBeenNthCalledWith(1, `/mailboxes/${ADDRESS}/drafts`, {
      limit: 12,
      cursor: undefined,
    });
    expect(http.get).toHaveBeenNthCalledWith(2, `/mailboxes/${ADDRESS}/drafts`, {
      limit: 12,
      cursor: "next",
    });
  });

  it("creates an ordinary empty draft without forward-only defaults", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_DETAIL);

    await new DraftsResource(http).create(ADDRESS);

    expect(http.post).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts`, {});
  });

  it("does not inject forward defaults into an ordinary populated draft", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_DETAIL);

    await new DraftsResource(http).create(ADDRESS, {
      subject: "Subject",
      bodyText: "Body",
    });

    expect(http.post).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts`, {
      subject: "Subject",
      body_text: "Body",
    });
  });

  it("serializes every create field and preserves null and false", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_DETAIL);

    await new DraftsResource(http).create(ADDRESS, {
      to: ["to@example.com"],
      cc: null,
      bcc: [],
      subject: null,
      bodyText: null,
      bodyHtml: "<p>note</p>",
      replyTo: null,
      threadId: null,
      inReplyToMessageId: null,
      references: null,
      attachments: [{
        filename: "image.png",
        contentType: "image/png",
        contentBase64: "eA==",
        contentId: "image",
      }],
      trackOpens: false,
      forwardMessageId: "source-id",
      forwardMode: ForwardMode.WRAPPED,
      includeOriginalAttachments: false,
      forwardNoteText: null,
      forwardNoteHtml: "<p>note</p>",
    });

    expect(http.post).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts`, {
      recipients: { to: ["to@example.com"], cc: null, bcc: [] },
      subject: null,
      body_text: null,
      body_html: "<p>note</p>",
      reply_to: null,
      thread_id: null,
      in_reply_to_message_id: null,
      references: null,
      attachments: [{
        filename: "image.png",
        content_type: "image/png",
        content_base64: "eA==",
        content_id: "image",
      }],
      track_opens: false,
      forward_message_id: "source-id",
      forward_mode: "wrapped",
      include_original_attachments: false,
      forward_note_text: null,
      forward_note_html: "<p>note</p>",
    });
  });

  it("gets a detail by exact path", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_DETAIL);

    const detail = await new DraftsResource(http).get(ADDRESS, DRAFT_ID);

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}`);
    expect(detail.bodyText).toBe("Draft body");
  });

  it("updates with generation in the body and preserves tri-state fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_DETAIL);

    await new DraftsResource(http).update(ADDRESS, DRAFT_ID, {
      generation: 4,
      recipients: { to: null, cc: [], bcc: undefined },
      subject: null,
      bodyText: undefined,
      bodyHtml: null,
      replyTo: null,
      threadId: null,
      inReplyToMessageId: null,
      references: null,
      trackOpens: false,
      forwardNoteText: null,
      forwardNoteHtml: undefined,
    });

    expect(http.patch).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}`, {
      generation: 4,
      recipients: { to: null, cc: [] },
      subject: null,
      body_html: null,
      reply_to: null,
      thread_id: null,
      in_reply_to_message_id: null,
      references: null,
      track_opens: false,
      forward_note_text: null,
    });
  });

  it("allows explicitly clearing recipients", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_DETAIL);

    await new DraftsResource(http).update(ADDRESS, DRAFT_ID, {
      generation: 4,
      recipients: null,
    });

    expect(http.patch).toHaveBeenCalledWith(expect.any(String), {
      generation: 4,
      recipients: null,
    });
  });

  it("duplicates with generation in the body", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_DETAIL);
    await new DraftsResource(http).duplicate(ADDRESS, DRAFT_ID, 4);
    expect(http.post).toHaveBeenCalledWith(
      `/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}/duplicate`,
      { generation: 4 },
    );
  });

  it("deletes with generation in the query", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    await new DraftsResource(http).delete(ADDRESS, DRAFT_ID, 4);
    expect(http.delete).toHaveBeenCalledWith(`/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}`, {
      params: { generation: 4 },
    });
  });

  it("adds attachments with generation in the body", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_DETAIL);
    await new DraftsResource(http).addAttachments(ADDRESS, DRAFT_ID, 4, [{
      filename: "a.txt",
      contentType: "text/plain",
      contentBase64: "YQ==",
    }]);
    expect(http.post).toHaveBeenCalledWith(
      `/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}/attachments`,
      {
        generation: 4,
        attachments: [{
          filename: "a.txt",
          content_type: "text/plain",
          content_base64: "YQ==",
        }],
      },
    );
  });

  it("removes an attachment with part index in the path and generation in the query", async () => {
    const http = mockHttp();
    vi.mocked(http.deleteWithResponse).mockResolvedValue(RAW_DETAIL);
    await new DraftsResource(http).removeAttachment(ADDRESS, DRAFT_ID, 2, 4);
    expect(http.deleteWithResponse).toHaveBeenCalledWith(
      `/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}/attachments/2`,
      { params: { generation: 4 } },
    );
  });

  it("downloads bytes and parses UTF-8 filename and content type", async () => {
    const http = mockHttp();
    vi.mocked(http.getBytes).mockResolvedValue({
      data: new Uint8Array([0, 1, 255]),
      headers: new Headers({
        "Content-Disposition": "attachment; filename*=UTF-8''report%201.txt",
        "Content-Type": "text/plain",
      }),
    });

    const attachment = await new DraftsResource(http).downloadAttachment(
      ADDRESS, DRAFT_ID, 2, 4,
    );

    expect(http.getBytes).toHaveBeenCalledWith(
      `/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}/attachments/2`,
      { generation: 4 },
    );
    expect(attachment).toEqual({
      content: new Uint8Array([0, 1, 255]),
      filename: "report 1.txt",
      contentType: "text/plain",
    });
  });

  it("sends with generation in the body and returns Message", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MESSAGE);
    const message = await new DraftsResource(http).send(ADDRESS, DRAFT_ID, 4);
    expect(http.post).toHaveBeenCalledWith(
      `/mailboxes/${ADDRESS}/drafts/${DRAFT_ID}/send`,
      { generation: 4 },
    );
    expect(message.id).toBe(RAW_MESSAGE.id);
  });

  it("preserves transport errors", async () => {
    const http = mockHttp();
    const error = new InkboxAPIError(409, {
      error: "draft_delivery_uncertain",
      message: "Draft delivery could not be confirmed.",
    });
    vi.mocked(http.post).mockRejectedValue(error);

    await expect(new DraftsResource(http).send(ADDRESS, DRAFT_ID, 4)).rejects.toBe(error);
  });
});
