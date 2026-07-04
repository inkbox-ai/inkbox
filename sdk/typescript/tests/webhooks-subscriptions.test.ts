// sdk/typescript/tests/webhooks-subscriptions.test.ts
//
// Round-trip + validation coverage for the WebhookSubscriptionsResource.
// Mocks the HTTP transport via `vi.fn()` (same pattern as
// signing-keys.test.ts) and exercises the public API surface.

import { describe, expect, it, vi } from "vitest";
import { WebhookSubscriptionsResource } from "../src/webhooks/subscriptions.js";
import type { RawWebhookSubscription } from "../src/webhooks/subscriptions.js";
import { HttpTransport } from "../src/_http.js";

const RAW_SUBSCRIPTION: RawWebhookSubscription = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "org_test",
  mailbox_id: "22222222-2222-2222-2222-222222222222",
  phone_number_id: null,
  url: "https://customer.example.com/hook",
  event_types: ["message.received", "message.bounced"],
  status: "active",
  created_at: "2026-04-10T18:00:00.000Z",
  updated_at: "2026-04-10T18:00:00.000Z",
};

function makeResource() {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
  const resource = new WebhookSubscriptionsResource(http);
  return {
    resource,
    http: http as {
      get: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    },
  };
}

describe("WebhookSubscriptionsResource.create", () => {
  it("posts the wire-shape body and parses the response", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue(RAW_SUBSCRIPTION);

    const sub = await resource.create({
      mailboxId: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      eventTypes: ["message.received", "message.bounced"],
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      mailbox_id: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      event_types: ["message.received", "message.bounced"],
    });
    expect(sub.id).toBe(RAW_SUBSCRIPTION.id);
    expect(sub.organizationId).toBe("org_test");
    expect(sub.mailboxId).toBe(RAW_SUBSCRIPTION.mailbox_id);
    expect(sub.phoneNumberId).toBeNull();
    expect(sub.eventTypes).toStrictEqual(["message.received", "message.bounced"]);
    expect(sub.createdAt).toBeInstanceOf(Date);
    expect(sub.contextConfig).toBeNull();
  });

  it("posts context_config when contextConfig is provided", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      context_config: {
        email: { mode: "count", count: 10 },
        texts: { mode: "window", hours: 24 },
        calls: null,
      },
    });

    const sub = await resource.create({
      mailboxId: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      eventTypes: ["message.received"],
      contextConfig: {
        email: { mode: "count", count: 10 },
        texts: { mode: "window", hours: 24 },
      },
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      mailbox_id: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      event_types: ["message.received"],
      context_config: {
        email: { mode: "count", count: 10 },
        texts: { mode: "window", hours: 24 },
      },
    });
    expect(sub.contextConfig).toStrictEqual({
      email: { mode: "count", count: 10 },
      texts: { mode: "window", hours: 24 },
      calls: null,
    });
  });

  it("accepts null class values in contextConfig", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      context_config: { email: null, texts: { mode: "count", count: 1 } },
    });

    await resource.create({
      mailboxId: "m",
      url: "https://x/y",
      eventTypes: ["message.received"],
      contextConfig: { email: null, texts: { mode: "count", count: 1 } },
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", expect.objectContaining({
      context_config: { email: null, texts: { mode: "count", count: 1 } },
    }));
  });

  it("rejects when both FKs are provided", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        phoneNumberId: "p",
        url: "https://x/y",
        eventTypes: ["message.received"],
      }),
    ).rejects.toThrow(/Exactly one of/);
  });

  it("rejects when neither FK is provided", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        url: "https://x/y",
        eventTypes: ["message.received"],
      }),
    ).rejects.toThrow(/Exactly one of/);
  });

  it("treats null mailboxId as no owner (still requires exactly one of)", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: null as unknown as string,
        url: "https://x/y",
        eventTypes: ["message.received"],
      }),
    ).rejects.toThrow(/Exactly one of/);
  });

  it("treats null phoneNumberId as no owner (still requires exactly one of)", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        phoneNumberId: null as unknown as string,
        url: "https://x/y",
        eventTypes: ["text.received"],
      }),
    ).rejects.toThrow(/Exactly one of/);
  });

  it("rejects empty eventTypes", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: "https://x/y",
        eventTypes: [],
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects duplicate eventTypes", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: "https://x/y",
        eventTypes: ["message.received", "message.received"],
      }),
    ).rejects.toThrow(/duplicate/);
  });

  it("rejects phone.incoming_call", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        phoneNumberId: "p",
        url: "https://x/y",
        eventTypes: ["phone.incoming_call"],
      }),
    ).rejects.toThrow(/incomingCallWebhookUrl/);
  });

  it("rejects channel mismatch — mailbox with text.*", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: "https://x/y",
        eventTypes: ["text.received"],
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("rejects channel mismatch — phone with message.*", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        phoneNumberId: "p",
        url: "https://x/y",
        eventTypes: ["message.received"],
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("rejects null url", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: null as unknown as string,
        eventTypes: ["message.received"],
      }),
    ).rejects.toThrow(/url must not be null/);
  });

  it("rejects null eventTypes (without crashing on .length)", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: "https://x/y",
        eventTypes: null as unknown as string[],
      }),
    ).rejects.toThrow(/eventTypes must not be null/);
  });

  it.each([
    [{ email: { mode: "count", count: 0 } }, /integer in 1\.\.50/],
    [{ email: { mode: "count", count: 51 } }, /integer in 1\.\.50/],
    [{ email: { mode: "count", count: 1.5 } }, /integer in 1\.\.50/],
    [{ texts: { mode: "window", hours: 0 } }, /integer in 1\.\.168/],
    [{ texts: { mode: "window", hours: 169 } }, /integer in 1\.\.168/],
    [{ calls: { mode: "latest", count: 5 } }, /mode must be 'count' or 'window'/],
    [{ notes: { mode: "count", count: 5 } }, /unknown class key/],
    [{ email: { mode: "count", count: 5, extra: true } }, /unknown key 'extra'/],
    [{ email: { mode: "count" } }, /integer in 1\.\.50/],
    [[], /must be an object/],
  ])("rejects invalid contextConfig %#", async (contextConfig, error) => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "m",
        url: "https://x/y",
        eventTypes: ["message.received"],
        contextConfig: contextConfig as never,
      }),
    ).rejects.toThrow(error);
  });

  it("accepts text.* for phone_number_id", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      mailbox_id: null,
      phone_number_id: "33333333-3333-3333-3333-333333333333",
      event_types: ["text.received", "text.delivered"],
    });
    const sub = await resource.create({
      phoneNumberId: "33333333-3333-3333-3333-333333333333",
      url: "https://x/y",
      eventTypes: ["text.received", "text.delivered"],
    });
    expect(sub.phoneNumberId).toBe("33333333-3333-3333-3333-333333333333");
    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", expect.objectContaining({
      phone_number_id: "33333333-3333-3333-3333-333333333333",
      event_types: ["text.received", "text.delivered"],
    }));
  });
});

describe("WebhookSubscriptionsResource.update", () => {
  it("sends only fields that were provided", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue(RAW_SUBSCRIPTION);

    await resource.update("subid", { url: "https://new/hook" });
    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { url: "https://new/hook" },
    );
  });

  it("sends event_types replacement when provided", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue(RAW_SUBSCRIPTION);

    await resource.update("subid", {
      eventTypes: ["message.received"],
    });
    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { event_types: ["message.received"] },
    );
  });

  it("omits context_config on update when contextConfig is undefined", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue(RAW_SUBSCRIPTION);

    await resource.update("subid", {});

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      {},
    );
  });

  it("sends context_config: null on update when clearing contextConfig", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue({ ...RAW_SUBSCRIPTION, context_config: null });

    const sub = await resource.update("subid", { contextConfig: null });

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { context_config: null },
    );
    expect(sub.contextConfig).toBeNull();
  });

  it("sends replacement context_config on update", async () => {
    const { resource, http } = makeResource();
    const contextConfig = {
      email: { mode: "count", count: 2 },
      calls: { mode: "window", hours: 12 },
    } as const;
    http.patch.mockResolvedValue({ ...RAW_SUBSCRIPTION, context_config: contextConfig });

    const sub = await resource.update("subid", { contextConfig });

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { context_config: contextConfig },
    );
    expect(sub.contextConfig).toStrictEqual(contextConfig);
  });

  it("rejects empty eventTypes", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", { eventTypes: [] }),
    ).rejects.toThrow(/non-empty/);
  });

  it("rejects duplicate eventTypes", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", { eventTypes: ["text.sent", "text.sent"] }),
    ).rejects.toThrow(/duplicate/);
  });

  it("rejects phone.incoming_call in eventTypes", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", { eventTypes: ["phone.incoming_call"] }),
    ).rejects.toThrow(/incomingCallWebhookUrl/);
  });

  it("rejects null url on update", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", { url: null as unknown as string }),
    ).rejects.toThrow(/url must not be null/);
  });

  it("rejects null eventTypes on update (without crashing on .length)", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", { eventTypes: null as unknown as string[] }),
    ).rejects.toThrow(/eventTypes must not be null/);
  });

  it("rejects invalid contextConfig on update", async () => {
    const { resource } = makeResource();
    await expect(
      resource.update("subid", {
        contextConfig: { email: { mode: "window", hours: 200 } } as never,
      }),
    ).rejects.toThrow(/integer in 1\.\.168/);
  });

  it("does not run channel coherence on update", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue(RAW_SUBSCRIPTION);

    await expect(
      resource.update("subid", { eventTypes: ["message.received", "text.received"] }),
    ).resolves.toBeDefined();
  });
});

describe("WebhookSubscriptionsResource.list", () => {
  it("builds the expected querystring params and unwraps the subscriptions envelope", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({
      subscriptions: [RAW_SUBSCRIPTION, { ...RAW_SUBSCRIPTION, id: "other" }],
    });

    const subs = await resource.list({
      mailboxId: "m",
      url: "https://x/y",
      eventType: "message.received",
    });

    expect(http.get).toHaveBeenCalledWith("/webhooks/subscriptions", {
      mailbox_id: "m",
      url: "https://x/y",
      event_type: "message.received",
    });
    expect(subs).toHaveLength(2);
    expect(subs[0].id).toBe(RAW_SUBSCRIPTION.id);
    expect(subs[1].id).toBe("other");
  });

  it("returns an empty list when the envelope contains no rows", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({ subscriptions: [] });
    const subs = await resource.list();
    expect(subs).toStrictEqual([]);
  });
});

describe("WebhookSubscriptionsResource.get / delete", () => {
  it("get parses the response", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue(RAW_SUBSCRIPTION);
    const sub = await resource.get(RAW_SUBSCRIPTION.id);
    expect(http.get).toHaveBeenCalledWith(`/webhooks/subscriptions/${RAW_SUBSCRIPTION.id}`);
    expect(sub.id).toBe(RAW_SUBSCRIPTION.id);
  });

  it("get parses echoed context_config", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      context_config: {
        email: { mode: "count", count: 3 },
        texts: null,
        calls: null,
      },
    });
    const sub = await resource.get(RAW_SUBSCRIPTION.id);
    expect(sub.contextConfig).toStrictEqual({
      email: { mode: "count", count: 3 },
      texts: null,
      calls: null,
    });
  });

  it("delete calls DELETE on the path", async () => {
    const { resource, http } = makeResource();
    http.delete.mockResolvedValue(undefined);
    await resource.delete("subid");
    expect(http.delete).toHaveBeenCalledWith("/webhooks/subscriptions/subid");
  });
});

const IDENTITY_ID = "44444444-4444-4444-4444-444444444444";

const RAW_IDENTITY_SUBSCRIPTION: RawWebhookSubscription = {
  ...RAW_SUBSCRIPTION,
  mailbox_id: null,
  agent_identity_id: IDENTITY_ID,
  event_types: ["imessage.received", "imessage.reaction_received"],
};

describe("WebhookSubscriptionsResource — agent identity owner", () => {
  it("creates an identity-owned imessage subscription", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue(RAW_IDENTITY_SUBSCRIPTION);

    const sub = await resource.create({
      agentIdentityId: IDENTITY_ID,
      url: "https://customer.example.com/hook",
      eventTypes: ["imessage.received", "imessage.reaction_received"],
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      url: "https://customer.example.com/hook",
      event_types: ["imessage.received", "imessage.reaction_received"],
      agent_identity_id: IDENTITY_ID,
    });
    expect(sub.agentIdentityId).toBe(IDENTITY_ID);
    expect(sub.mailboxId).toBeNull();
    expect(sub.phoneNumberId).toBeNull();
  });

  it("rejects imessage events on a mailbox owner", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "22222222-2222-2222-2222-222222222222",
        url: "https://x.example.com/hook",
        eventTypes: ["imessage.received"],
      }),
    ).rejects.toThrow(/agent_identity/);
  });

  it("rejects text events on an agent identity owner", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        agentIdentityId: IDENTITY_ID,
        url: "https://x.example.com/hook",
        eventTypes: ["text.received"],
      }),
    ).rejects.toThrow(/phone_number/);
  });

  it("rejects multiple owners including the identity", async () => {
    const { resource } = makeResource();
    await expect(
      resource.create({
        mailboxId: "22222222-2222-2222-2222-222222222222",
        agentIdentityId: IDENTITY_ID,
        url: "https://x.example.com/hook",
        eventTypes: ["imessage.received"],
      }),
    ).rejects.toThrow(/Exactly one/);
  });

  it("passes the agent identity list filter", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({ subscriptions: [RAW_IDENTITY_SUBSCRIPTION] });

    const rows = await resource.list({ agentIdentityId: IDENTITY_ID });

    expect(http.get).toHaveBeenCalledWith("/webhooks/subscriptions", {
      agent_identity_id: IDENTITY_ID,
    });
    expect(rows[0].agentIdentityId).toBe(IDENTITY_ID);
  });

  it("defaults a missing agent_identity_id to null when parsing", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({ subscriptions: [RAW_SUBSCRIPTION] });

    const rows = await resource.list();

    expect(rows[0].agentIdentityId).toBeNull();
  });
});
