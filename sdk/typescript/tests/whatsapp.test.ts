import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Inkbox,
  WhatsAppResource,
  parseWhatsAppMessage,
} from "../src/index.js";
import { HttpTransport } from "../src/_http.js";
import type {
  RawWhatsAppMessage,
  WhatsAppWebhookPayload,
} from "../src/index.js";
const f = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/whatsapp.json", import.meta.url),
    "utf8",
  ),
);
const owner = f.identity_id,
  conv = f.conversation.id,
  media = f.media.id;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const last = () => {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return {
    url: new URL(String(url)),
    init: init!,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
  };
};
const resource = () =>
  new WhatsAppResource(
    new HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp"),
  );
afterEach(() => vi.restoreAllMocks());
describe("WhatsApp public wire", () => {
  it("keeps ownership out of body and confirmed sent distinct from unknown delivery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ok({ message: f.message }, 201)),
    );
    const message = await resource().send({
      to: ["+15555550101"],
      text: "Hello",
      mediaIds: [media],
      agentIdentityId: owner,
      idempotencyKey: "logical-send",
    });
    expect(last().url.searchParams.get("agent_identity_id")).toBe(owner);
    expect(last().body).toEqual({
      to: ["+15555550101"],
      text: "Hello",
      media_ids: [media],
    });
    expect(new Headers(last().init.headers).get("Idempotency-Key")).toBe(
      "logical-send",
    );
    expect(message.status).toBe("sent");
    expect(message.deliveryState).toBe("unknown");
    expect(message.failedAt).toBeNull();
  });
  it("rejects invalid sends before I/O and counts Unicode code points", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const options of [
      {},
      { to: "+15555550101", conversationId: conv, text: "hi" },
      { to: [], text: "hi" },
      { to: ["+15555550101", "+15555550102"], text: "hi" },
      { to: "+15555550101", text: " " },
      { to: "+15555550101", text: "😀".repeat(4001) },
      { to: "+15555550101", mediaIds: [media, media] },
    ])
      await expect(resource().send(options)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(ok({ message: f.message }, 201));
    await resource().send({ conversationId: conv, text: "😀".repeat(4000) });
  });
  it("retains bare array pagination and unavailable attachment identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([f.inbound_message])));
    const rows = await resource().list({
      agentIdentityId: owner,
      conversationId: conv,
      limit: 10,
      offset: 4,
      isRead: false,
      isBlocked: false,
    });
    expect(Object.fromEntries(last().url.searchParams)).toEqual({
      agent_identity_id: owner,
      conversation_id: conv,
      limit: "10",
      offset: "4",
      is_read: "false",
      is_blocked: "false",
    });
    expect(rows[0].media[0]).toMatchObject({
      id: media,
      status: "unavailable",
      url: null,
    });
    vi.mocked(fetch).mockResolvedValue(ok(f.message));
    expect(
      (await resource().get(f.message.id, { agentIdentityId: owner })).id,
    ).toBe(f.message.id);
    vi.mocked(fetch).mockResolvedValue(ok([f.conversation_summary]));
    expect(
      (await resource().listConversations({ agentIdentityId: owner }))[0]
        .unreadCount,
    ).toBe(2);
    vi.mocked(fetch).mockResolvedValue(ok(f.conversation));
    expect((await resource().getConversation(conv)).participants).toEqual([
      "+15555550101",
    ]);
  });
  it("owns multipart uploads and renews URLs through GET without re-uploading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(f.media, 201)));
    await resource().uploadMedia({
      content: new Uint8Array([1, 2, 3]),
      filename: "image.png",
      contentType: "image/png",
      agentIdentityId: owner,
    });
    expect(last().url.searchParams.get("agent_identity_id")).toBe(owner);
    expect(last().body).toBeInstanceOf(FormData);
    expect((last().body as FormData).get("file")).toBeInstanceOf(Blob);
    await expect(
      resource().uploadMedia({
        content: new Uint8Array(20 * 1024 * 1024 + 1),
        filename: "large",
      }),
    ).rejects.toThrow("20 MiB");
    vi.mocked(fetch).mockResolvedValue(
      ok({ ...f.media, url: "https://media.example/fresh" }),
    );
    expect(
      (await resource().getMedia(media, { agentIdentityId: owner })).url,
    ).toContain("fresh");
    expect(last().url.pathname).toContain(`/media/${media}`);
  });
  it("marks local read state through an exact visible boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(ok({ conversation_id: conv, updated_count: 2 })),
    );
    expect(
      await resource().markRead(conv, f.message.id, { agentIdentityId: owner }),
    ).toEqual({ conversationId: conv, updatedCount: 2 });
    expect(last().body).toEqual({
      conversation_id: conv,
      through_message_id: f.message.id,
    });
  });
  it("queries fresh status and does not deny sends from an older disabled snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          ok({
            id: owner,
            organization_id: "org_example",
            agent_handle: "agent",
            created_at: f.message.created_at,
            updated_at: f.message.updated_at,
          }),
        ),
    );
    const client = new Inkbox({ apiKey: "test-only" });
    const identity = await client.getIdentity("agent");
    expect(identity.whatsappEnabled).toBe(false);
    vi.mocked(fetch).mockResolvedValue(ok({ message: f.message }, 201));
    await identity.sendWhatsApp({ to: "+15555550101", text: "Hi" });
    expect(last().url.searchParams.get("agent_identity_id")).toBe(owner);
    vi.mocked(fetch).mockResolvedValue(ok({ whatsapp: f.status }));
    expect((await identity.getWhatsAppStatus())?.enabled).toBe(true);
    vi.mocked(fetch).mockResolvedValue(ok({ imessage: {} }));
    expect(await identity.getWhatsAppStatus()).toBeNull();
  });
  it("exports raw webhook payloads without converting received URLs or timestamps", () => {
    const webhook: WhatsAppWebhookPayload = f.webhook;
    expect(webhook.data.message.sender_number).toBe("+15555550101");
    expect(webhook.data.message.media[0].url).toBeNull();
    expect(
      parseWhatsAppMessage(f.message as RawWhatsAppMessage).createdAt,
    ).toBeInstanceOf(Date);
  });
});
