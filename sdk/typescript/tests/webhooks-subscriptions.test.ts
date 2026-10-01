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
    ).rejects.toThrow(/incoming-call action/);
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

describe("WebhookSubscriptionsResource — auth token", () => {
  it("posts auth_token when authToken is provided on create", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      has_auth_token: true,
      auth_token: "your-endpoint-token",
    });

    const sub = await resource.create({
      mailboxId: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      eventTypes: ["message.received"],
      authToken: "your-endpoint-token",
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      mailbox_id: "22222222-2222-2222-2222-222222222222",
      url: "https://customer.example.com/hook",
      event_types: ["message.received"],
      auth_token: "your-endpoint-token",
    });
    expect(sub.hasAuthToken).toBe(true);
    expect(sub.authToken).toBe("your-endpoint-token");
  });

  it("omits auth_token on create when authToken is undefined", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue(RAW_SUBSCRIPTION);

    await resource.create({
      mailboxId: "m",
      url: "https://x/y",
      eventTypes: ["message.received"],
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      mailbox_id: "m",
      url: "https://x/y",
      event_types: ["message.received"],
    });
  });

  it("sends replacement auth_token on update", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      has_auth_token: true,
      auth_token: "your-endpoint-token",
    });

    const sub = await resource.update("subid", { authToken: "your-endpoint-token" });

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { auth_token: "your-endpoint-token" },
    );
    expect(sub.hasAuthToken).toBe(true);
    expect(sub.authToken).toBe("your-endpoint-token");
  });

  it("sends auth_token: null on update when clearing the token", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue({
      ...RAW_SUBSCRIPTION,
      has_auth_token: false,
      auth_token: null,
    });

    const sub = await resource.update("subid", { authToken: null });

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { auth_token: null },
    );
    expect(sub.hasAuthToken).toBe(false);
    expect(sub.authToken).toBeNull();
  });

  it("omits auth_token on update when authToken is undefined", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue(RAW_SUBSCRIPTION);

    await resource.update("subid", { url: "https://new/hook" });

    expect(http.patch).toHaveBeenCalledWith(
      "/webhooks/subscriptions/subid",
      { url: "https://new/hook" },
    );
  });

  it("parses the auth-token fields and defaults missing keys", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({
      subscriptions: [
        { ...RAW_SUBSCRIPTION, has_auth_token: true, auth_token: "your-endpoint-token" },
        { ...RAW_SUBSCRIPTION, has_auth_token: false, auth_token: null },
        RAW_SUBSCRIPTION,
      ],
    });

    const rows = await resource.list();

    expect(rows[0].hasAuthToken).toBe(true);
    expect(rows[0].authToken).toBe("your-endpoint-token");
    expect(rows[1].hasAuthToken).toBe(false);
    expect(rows[1].authToken).toBeNull();
    // Older payloads without the keys must keep parsing.
    expect(rows[2].hasAuthToken).toBe(false);
    expect(rows[2].authToken).toBeNull();
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
    ).rejects.toThrow(/incoming-call action/);
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





  it("accepts call.ended on an agent identity owner", async () => {
    const { resource, http } = makeResource();
    http.post.mockResolvedValue({
      ...RAW_IDENTITY_SUBSCRIPTION,
      event_types: ["call.ended"],
    });

    const sub = await resource.create({
      agentIdentityId: IDENTITY_ID,
      url: "https://customer.example.com/hook",
      eventTypes: ["call.ended"],
    });

    expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
      url: "https://customer.example.com/hook",
      event_types: ["call.ended"],
      agent_identity_id: IDENTITY_ID,
    });
    expect(sub.agentIdentityId).toBe(IDENTITY_ID);
  });



  it("accepts A2A events on an identity subscription", async () => {
    const { resource, http } = makeResource();
    const eventTypes = ["a2a.task.created", "a2a.task.message"];
    http.post.mockResolvedValue({
      ...RAW_IDENTITY_SUBSCRIPTION,
      event_types: eventTypes,
    });

    const sub = await resource.create({
      agentIdentityId: IDENTITY_ID,
      url: "https://x.example.com/hook",
      eventTypes,
    });

    expect(sub.eventTypes).toEqual(eventTypes);
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
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["agentIdentityId", "agent_identity_id"],
    ["mailboxId", "mailbox_id"],
    ["phoneNumberId", "phone_number_id"],
  ] as const)("explicitly broadens the %s view", async (filter, wireKey) => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValueOnce({ supports_identity_subscriptions: true })
      .mockResolvedValueOnce({ subscriptions: [] });
    await resource.list({ [filter]: IDENTITY_ID, scope: "identity" });
    expect(http.get.mock.calls).toEqual([
      ["/webhooks/catalog"],
      ["/webhooks/subscriptions", { [wireKey]: IDENTITY_ID, scope: "identity" }],
    ]);
  });

  it.each([{}, { supports_identity_subscriptions: false }, { supports_identity_subscriptions: "true" }])(
    "rejects unsupported identity scope without returning a partial list: %j", async (catalog) => {
      const { resource, http } = makeResource();
      http.get.mockResolvedValue(catalog);
      await expect(resource.list({ scope: "identity" })).rejects.toThrow("channel-filtered lists without scope");
      expect(http.get.mock.calls).toEqual([["/webhooks/catalog"]]);
    },
  );

  it("checks availability again after activation", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValueOnce({}).mockResolvedValueOnce({ supports_identity_subscriptions: true })
      .mockResolvedValueOnce({ subscriptions: [] });
    await expect(resource.list({ scope: "identity" })).rejects.toThrow("not supported");
    expect(await resource.list({ scope: "identity" })).toEqual([]);
    expect(http.get).toHaveBeenCalledTimes(3);
  });

  it("defaults a missing agent_identity_id to null when parsing", async () => {
    const { resource, http } = makeResource();
    http.get.mockResolvedValue({ subscriptions: [RAW_SUBSCRIPTION] });

    const rows = await resource.list();

    expect(rows[0].agentIdentityId).toBeNull();
  });
});


const ALL_NOTIFICATION_EVENTS = [
  "message.received", "message.sent", "message.forwarded", "message.delivered",
  "message.bounced", "message.failed", "text.received", "text.sent", "text.delivered",
  "text.delivery_failed", "text.delivery_unconfirmed", "imessage.received",
  "imessage.reaction_received", "imessage.sent", "imessage.delivered",
  "imessage.delivery_failed", "call.ended", "a2a.task.created", "a2a.task.message",
  "a2a.task.canceled", "a2a.sent_task.updated",
];

describe("identity-owned mixed notifications", () => {
  it.each(["agentIdentityId", "mailboxId", "phoneNumberId"] as const)(
    "accepts all events plus context through %s without looking up channels", async (selector) => {
      const { resource, http } = makeResource();
      const contextConfig = { email: { mode: "count" as const, count: 2 } };
      http.post.mockResolvedValue({ ...RAW_SUBSCRIPTION, mailbox_id: null,
        phone_number_id: null, agent_identity_id: IDENTITY_ID,
        event_types: ALL_NOTIFICATION_EVENTS });
      const row = await resource.create({ [selector]: IDENTITY_ID,
        url: "https://example.com/hook", eventTypes: ALL_NOTIFICATION_EVENTS, contextConfig });
      const wireSelector = { agentIdentityId: "agent_identity_id", mailboxId: "mailbox_id",
        phoneNumberId: "phone_number_id" }[selector];
      expect(http.post).toHaveBeenCalledWith("/webhooks/subscriptions", {
        [wireSelector]: IDENTITY_ID, url: "https://example.com/hook",
        event_types: ALL_NOTIFICATION_EVENTS, context_config: contextConfig });
      expect(http.get).not.toHaveBeenCalled();
      expect(row.eventTypes).toEqual(ALL_NOTIFICATION_EVENTS);
    });

  it("sends full event replacement and direct subscription deletion", async () => {
    const { resource, http } = makeResource();
    http.patch.mockResolvedValue({ ...RAW_SUBSCRIPTION, event_types: ALL_NOTIFICATION_EVENTS });
    const row = await resource.update(RAW_SUBSCRIPTION.id, { eventTypes: ALL_NOTIFICATION_EVENTS,
      contextConfig: { email: { mode: "count", count: 2 } } });
    expect(http.patch).toHaveBeenCalledWith(`/webhooks/subscriptions/${RAW_SUBSCRIPTION.id}`, {
      event_types: ALL_NOTIFICATION_EVENTS,
      context_config: { email: { mode: "count", count: 2 } } });
    expect(row.eventTypes).toEqual(ALL_NOTIFICATION_EVENTS);
    await resource.delete(row.id);
    expect(http.delete).toHaveBeenCalledWith(`/webhooks/subscriptions/${row.id}`);
  });

  it("preserves overlap conflicts without retrying", async () => {
    const { resource, http } = makeResource();
    const error = new Error("Subscription events overlap an existing destination");
    http.patch.mockRejectedValue(error);
    await expect(resource.update(RAW_SUBSCRIPTION.id, { eventTypes: ["message.received"] })).rejects.toBe(error);
    expect(http.patch).toHaveBeenCalledTimes(1);
  });
});

it.each([undefined, "identity"] as const)("keeps mutation scope explicit (%s) without a catalog request", async (scope) => {
  const { resource, http } = makeResource();
  http.patch.mockResolvedValue(RAW_SUBSCRIPTION);
  await resource.update("subid", { url: "https://example.com/new", scope });
  await resource.delete("subid", { scope });
  const suffix = scope ? "?scope=identity" : "";
  expect(http.patch).toHaveBeenCalledWith(`/webhooks/subscriptions/subid${suffix}`, { url: "https://example.com/new" });
  expect(http.delete).toHaveBeenCalledWith(`/webhooks/subscriptions/subid${suffix}`);
  expect(http.get).not.toHaveBeenCalled();
});
