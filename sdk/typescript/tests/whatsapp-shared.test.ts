import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InkboxAPIError, WhatsAppAwaitingInboundError, WhatsAppResource } from "../src/index.js";
import { HttpTransport } from "../src/_http.js";

const s = JSON.parse(readFileSync(new URL("../../../tests/fixtures/whatsapp-shared.json", import.meta.url), "utf8"));
const owner = s.identity_id, recipient = s.recipient_number;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const last = () => {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  return { url: new URL(String(url)), init: init!, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body };
};
const resource = () => new WhatsAppResource(new HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp"));
afterEach(() => vi.restoreAllMocks());

describe("WhatsApp shared-number connections", () => {
  it("connects with the exact body and required key, and sends no message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(s.connect, 201)));
    const result = await resource().connect({ agentIdentityId: owner, recipientNumber: recipient, idempotencyKey: "connect-1" });
    expect(last().url.pathname).toBe("/api/v1/whatsapp/connect");
    expect(last().init.method).toBe("POST");
    expect(last().body).toEqual({ agent_identity_id: owner, recipient_number: recipient });
    expect(new Headers(last().init.headers).get("Idempotency-Key")).toBe("connect-1");
    expect(result.number).toBe(s.connect.number);
    expect(result.awaitingInbound).toBe(true);
    expect(result.alreadyConnected).toBe(false);
    expect(result.connection.numberType).toBe("dedicated_shared");
    expect(result.connection.lastActivityAt.toISOString()).toBe("2026-10-01T12:05:00.000Z");
  });

  it("rejects invalid recipients, owners, and keys before requesting", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const method of ["connect", "disconnect"] as const) {
      for (const o of [
        { agentIdentityId: owner, recipientNumber: "+15555550101,+15555550102", idempotencyKey: "k" },
        { agentIdentityId: owner, recipientNumber: "5555550101", idempotencyKey: "k" },
        { agentIdentityId: "agent", recipientNumber: recipient, idempotencyKey: "k" },
        { agentIdentityId: owner, recipientNumber: recipient, idempotencyKey: " " },
        { agentIdentityId: owner, recipientNumber: recipient, idempotencyKey: "k".repeat(256) },
      ]) {
        await expect(resource()[method](o)).rejects.toThrow();
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns released and already-disconnected results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok(s.disconnect)).mockResolvedValueOnce(ok(s.already_disconnected)));
    const first = await resource().disconnect({ agentIdentityId: owner, recipientNumber: recipient, idempotencyKey: "d-1" });
    expect(last().url.pathname).toBe("/api/v1/whatsapp/disconnect");
    expect(last().body).toEqual({ agent_identity_id: owner, recipient_number: recipient });
    expect(new Headers(last().init.headers).get("Idempotency-Key")).toBe("d-1");
    expect(first).toEqual({ connectionId: s.disconnect.connection_id, disconnected: true });
    const second = await resource().disconnect({ agentIdentityId: owner, recipientNumber: recipient, idempotencyKey: "d-2" });
    expect(second).toEqual({ connectionId: null, disconnected: true });
  });

  it("lists connections for an owner and reads the router", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ items: [s.connection] })).mockResolvedValueOnce(ok(s.router)));
    const rows = await resource().listConnections({ agentIdentityId: owner });
    expect(last().url.pathname).toBe("/api/v1/whatsapp/connections");
    expect(last().url.searchParams.get("agent_identity_id")).toBe(owner);
    expect(rows.map((row) => row.id)).toEqual([s.connection.id]);
    expect(rows[0].recipientNumber).toBe(recipient);
    expect(await resource().getRouter()).toEqual({ number: s.router.number, numberType: "dedicated_triage" });
    expect(last().url.pathname).toBe("/api/v1/whatsapp/router");
  });

  it("forwards an optional media recipient and validates it", async () => {
    const media = { id: "40000000-0000-4000-8000-000000000004", filename: "a.png", content_type: "image/png", size: 3, status: "ready", url: null };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok(media, 201)));
    await resource().uploadMedia({ content: new Uint8Array([1]), filename: "a.png", agentIdentityId: owner, recipientNumber: recipient });
    expect(last().url.searchParams.get("recipient_number")).toBe(recipient);
    expect(last().url.searchParams.get("agent_identity_id")).toBe(owner);
    await resource().uploadMedia({ content: new Uint8Array([1]), filename: "a.png", agentIdentityId: owner });
    expect(last().url.searchParams.has("recipient_number")).toBe(false);
    await expect(resource().uploadMedia({ content: new Uint8Array([1]), filename: "a.png", recipientNumber: "nope" })).rejects.toThrow(/E\.164/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("types a reply before the recipient's first message and keeps its key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok({ detail: s.awaiting_inbound_error }, 409)));
    const error = await resource().send({ to: recipient, text: "Hello", agentIdentityId: owner, idempotencyKey: "reply-1" }).catch((e) => e);
    expect(error).toBeInstanceOf(WhatsAppAwaitingInboundError);
    expect(error).toBeInstanceOf(InkboxAPIError);
    expect(error.statusCode).toBe(409);
    expect(error.retryCondition).toBe("recipient_message");
    expect(error.idempotencyKey).toBe("reply-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
