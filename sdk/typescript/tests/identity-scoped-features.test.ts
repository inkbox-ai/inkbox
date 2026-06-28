// sdk/typescript/tests/identity-scoped-features.test.ts
//
// Tests for the identity-scoped contact rules + per-identity signing keys:
// - MailIdentityContactRulesResource / PhoneIdentityContactRulesResource
// - SigningKeysResource per-identity status/rotate (+ deprecated org-level)
// - WebhookSubscriptionsResource.create -> WebhookSubscriptionCreateResponse
// - AgentIdentity convenience methods + identity.update filter modes
//
// Mirrors sdk/python/tests/test_identity_scoped_features.py. Uses the
// vi.fn() mock-transport pattern (same as signing-keys.test.ts).

import { describe, it, expect, vi } from "vitest";
import { HttpTransport, InkboxError } from "../src/_http.js";
import { AgentIdentity } from "../src/agent_identity.js";
import {
  parseAgentIdentityData,
  parseAgentIdentitySummary,
} from "../src/identities/types.js";
import {
  ContactRuleStatus,
  FilterMode,
  MailIdentityContactRule,
  MailRuleAction,
  MailRuleMatchType,
  parseMailIdentityContactRule,
} from "../src/mail/types.js";
import { MailIdentityContactRulesResource } from "../src/mail/resources/identityContactRules.js";
import {
  PhoneIdentityContactRule,
  PhoneRuleAction,
  parsePhoneIdentityContactRule,
} from "../src/phone/types.js";
import { PhoneIdentityContactRulesResource } from "../src/phone/resources/identityContactRules.js";
import {
  SigningKeysResource,
  SigningKeyStatus,
} from "../src/signing_keys.js";
import {
  WebhookSubscriptionsResource,
  parseWebhookSubscription,
} from "../src/webhooks/subscriptions.js";
import type { RawWebhookSubscriptionCreateResponse } from "../src/webhooks/subscriptions.js";
import type { Inkbox } from "../src/inkbox.js";
import { RAW_IDENTITY_DETAIL } from "./sampleData.js";

const AGENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const MAIL_RULE_DICT = {
  id: "11111111-1111-1111-1111-111111111111",
  agent_identity_id: AGENT_ID,
  action: "block",
  match_type: "exact_email",
  match_target: "spam@example.com",
  status: "active",
  created_at: "2026-06-09T12:30:00Z",
  updated_at: "2026-06-09T12:30:00Z",
};

const PHONE_RULE_DICT = {
  id: "22222222-2222-2222-2222-222222222222",
  agent_identity_id: AGENT_ID,
  action: "block",
  match_type: "exact_number",
  match_target: "+14155550199",
  status: "active",
  created_at: "2026-06-09T12:30:00Z",
  updated_at: "2026-06-09T12:30:00Z",
};

// ---------------------------------------------------------------------------
// Mail identity contact-rule resource
// ---------------------------------------------------------------------------

function makeMailResource() {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
  return {
    resource: new MailIdentityContactRulesResource(http),
    http: http as {
      get: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    },
  };
}

describe("MailIdentityContactRulesResource", () => {
  it("list hits the identity path, forwards params, and parses agentIdentityId", async () => {
    const { resource, http } = makeMailResource();
    http.get.mockResolvedValue([MAIL_RULE_DICT]);

    const rows = await resource.list("my-agent", { action: MailRuleAction.BLOCK });

    expect(http.get).toHaveBeenCalledOnce();
    expect(http.get).toHaveBeenCalledWith(
      "/identities/my-agent/mail-contact-rules",
      { action: "block" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject<Partial<MailIdentityContactRule>>({
      agentIdentityId: AGENT_ID,
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("list unwraps an { items } envelope too", async () => {
    const { resource, http } = makeMailResource();
    http.get.mockResolvedValue({ items: [MAIL_RULE_DICT] });

    const rows = await resource.list("my-agent");

    expect(http.get).toHaveBeenCalledWith(
      "/identities/my-agent/mail-contact-rules",
      {},
    );
    expect(rows[0].agentIdentityId).toBe(AGENT_ID);
  });

  it("create posts the wire-shape body to the identity path", async () => {
    const { resource, http } = makeMailResource();
    http.post.mockResolvedValue(MAIL_RULE_DICT);

    await resource.create("my-agent", {
      action: MailRuleAction.BLOCK,
      matchType: MailRuleMatchType.EXACT_EMAIL,
      matchTarget: "spam@example.com",
    });

    expect(http.post).toHaveBeenCalledWith(
      "/identities/my-agent/mail-contact-rules",
      {
        action: "block",
        match_type: "exact_email",
        match_target: "spam@example.com",
      },
    );
  });

  it("get / update / delete use the per-rule identity paths", async () => {
    const { resource, http } = makeMailResource();
    http.get.mockResolvedValue(MAIL_RULE_DICT);
    http.patch.mockResolvedValue(MAIL_RULE_DICT);
    http.delete.mockResolvedValue(undefined);
    const rid = MAIL_RULE_DICT.id;

    await resource.get("my-agent", rid);
    expect(http.get).toHaveBeenCalledWith(
      `/identities/my-agent/mail-contact-rules/${rid}`,
    );

    await resource.update("my-agent", rid, { status: ContactRuleStatus.PAUSED });
    expect(http.patch).toHaveBeenCalledWith(
      `/identities/my-agent/mail-contact-rules/${rid}`,
      { status: "paused" },
    );

    await resource.delete("my-agent", rid);
    expect(http.delete).toHaveBeenCalledWith(
      `/identities/my-agent/mail-contact-rules/${rid}`,
    );
  });

  it("listAll hits the org-wide path filtered by agentIdentityId", async () => {
    const { resource, http } = makeMailResource();
    http.get.mockResolvedValue([MAIL_RULE_DICT]);

    await resource.listAll({ agentIdentityId: AGENT_ID });

    expect(http.get).toHaveBeenCalledWith("/mail/contact-rules", {
      agent_identity_id: AGENT_ID,
    });
  });
});

// ---------------------------------------------------------------------------
// Phone identity contact-rule resource
// ---------------------------------------------------------------------------

function makePhoneResource() {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
  return {
    resource: new PhoneIdentityContactRulesResource(http),
    http: http as {
      get: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
      patch: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    },
  };
}

describe("PhoneIdentityContactRulesResource", () => {
  it("list hits the identity path and parses agentIdentityId", async () => {
    const { resource, http } = makePhoneResource();
    http.get.mockResolvedValue([PHONE_RULE_DICT]);

    const rows = await resource.list("my-agent");

    expect(http.get).toHaveBeenCalledWith(
      "/identities/my-agent/phone-contact-rules",
      {},
    );
    expect(rows[0]).toMatchObject<Partial<PhoneIdentityContactRule>>({
      agentIdentityId: AGENT_ID,
    });
  });

  it("create defaults matchType to exact_number", async () => {
    const { resource, http } = makePhoneResource();
    http.post.mockResolvedValue(PHONE_RULE_DICT);

    await resource.create("my-agent", {
      action: PhoneRuleAction.BLOCK,
      matchTarget: "+14155550199",
    });

    expect(http.post).toHaveBeenCalledWith(
      "/identities/my-agent/phone-contact-rules",
      {
        action: "block",
        match_type: "exact_number",
        match_target: "+14155550199",
      },
    );
  });

  it("listAll hits the org-wide path filtered by agentIdentityId + action", async () => {
    const { resource, http } = makePhoneResource();
    http.get.mockResolvedValue([PHONE_RULE_DICT]);

    await resource.listAll({ agentIdentityId: AGENT_ID, action: PhoneRuleAction.BLOCK });

    expect(http.get).toHaveBeenCalledWith("/phone/contact-rules", {
      agent_identity_id: AGENT_ID,
      action: "block",
    });
  });
});

// ---------------------------------------------------------------------------
// Signing keys (per-identity + deprecated org-level)
// ---------------------------------------------------------------------------

function makeSigningResource() {
  const http = {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as HttpTransport;
  return {
    resource: new SigningKeysResource(http),
    http: http as {
      get: ReturnType<typeof vi.fn>;
      post: ReturnType<typeof vi.fn>;
    },
  };
}

describe("SigningKeysResource (per-identity + org-level)", () => {
  it("createOrRotate(handle) hits the per-identity path", async () => {
    const { resource, http } = makeSigningResource();
    http.post.mockResolvedValue({
      signing_key: "sk-fresh",
      created_at: "2026-06-09T00:00:00Z",
    });

    const key = await resource.createOrRotate("my-agent");

    expect(http.post).toHaveBeenCalledWith("/identities/my-agent/signing-key", {});
    expect(key.signingKey).toBe("sk-fresh");
    expect(key.createdAt).toBeInstanceOf(Date);
  });

  it("createOrRotate() with no handle hits the deprecated org path", async () => {
    const { resource, http } = makeSigningResource();
    http.post.mockResolvedValue({
      signing_key: "sk-org",
      created_at: "2026-06-09T00:00:00Z",
    });

    await resource.createOrRotate();

    expect(http.post).toHaveBeenCalledWith("/signing-keys", {});
  });

  it("getStatus(handle) hits the per-identity path and parses configured + createdAt", async () => {
    const { resource, http } = makeSigningResource();
    http.get.mockResolvedValue({
      configured: true,
      created_at: "2026-06-09T00:00:00Z",
    });

    const status = await resource.getStatus("my-agent");

    expect(http.get).toHaveBeenCalledWith("/identities/my-agent/signing-key");
    expect(status).toMatchObject<Partial<SigningKeyStatus>>({ configured: true });
    expect(status.createdAt).toBeInstanceOf(Date);
    expect(status.createdAt?.toISOString()).toBe("2026-06-09T00:00:00.000Z");
  });

  it("getStatus parses the not-configured shape (createdAt null)", async () => {
    const { resource, http } = makeSigningResource();
    http.get.mockResolvedValue({ configured: false, created_at: null });

    const status = await resource.getStatus("my-agent");

    expect(status.configured).toBe(false);
    expect(status.createdAt).toBeNull();
  });

  it("getStatus() with no handle hits the deprecated org path", async () => {
    const { resource, http } = makeSigningResource();
    http.get.mockResolvedValue({ configured: true, created_at: null });

    await resource.getStatus();

    expect(http.get).toHaveBeenCalledWith("/signing-keys");
  });
});

// ---------------------------------------------------------------------------
// Webhook subscription create-response (signingKey + ownerIdentityId)
// ---------------------------------------------------------------------------

function rawSub(
  overrides: Partial<RawWebhookSubscriptionCreateResponse> = {},
): RawWebhookSubscriptionCreateResponse {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    organization_id: "org_abc",
    mailbox_id: "44444444-4444-4444-4444-444444444444",
    phone_number_id: null,
    agent_identity_id: null,
    owner_identity_id: AGENT_ID,
    url: "https://example.com/hook",
    event_types: ["message.received"],
    status: "active",
    created_at: "2026-06-09T00:00:00Z",
    updated_at: "2026-06-09T00:00:00Z",
    ...overrides,
  };
}

function makeWebhookResource() {
  const http = { post: vi.fn() } as unknown as HttpTransport;
  return {
    resource: new WebhookSubscriptionsResource(http),
    http: http as { post: ReturnType<typeof vi.fn> },
  };
}

describe("WebhookSubscriptionsResource.create -> create response", () => {
  it("returns the one-time signingKey and resolved ownerIdentityId when present", async () => {
    const { resource, http } = makeWebhookResource();
    http.post.mockResolvedValue(rawSub({ signing_key: "sk-once" }));

    const result = await resource.create({
      mailboxId: "44444444-4444-4444-4444-444444444444",
      url: "https://example.com/hook",
      eventTypes: ["message.received"],
    });

    expect(result.signingKey).toBe("sk-once");
    expect(result.ownerIdentityId).toBe(AGENT_ID);
  });

  it("returns signingKey null when the server omits it", async () => {
    const { resource, http } = makeWebhookResource();
    http.post.mockResolvedValue(rawSub()); // no signing_key field

    const result = await resource.create({
      mailboxId: "44444444-4444-4444-4444-444444444444",
      url: "https://example.com/hook",
      eventTypes: ["message.received"],
    });

    expect(result.signingKey).toBeNull();
  });

  it("parses ownerIdentityId and tolerates it being absent (back-compat)", () => {
    expect(parseWebhookSubscription(rawSub()).ownerIdentityId).toBe(AGENT_ID);

    const legacy = rawSub();
    delete (legacy as { owner_identity_id?: string | null }).owner_identity_id;
    expect(parseWebhookSubscription(legacy).ownerIdentityId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AgentIdentity convenience methods + filter-mode update
// ---------------------------------------------------------------------------

function mockInkbox() {
  return {
    _mailIdentityContactRules: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    _phoneIdentityContactRules: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    _signingKeys: { createOrRotate: vi.fn(), getStatus: vi.fn() },
    _idsResource: { update: vi.fn(), get: vi.fn() },
  } as unknown as Inkbox;
}

function identityWithPhone() {
  const data = parseAgentIdentityData(RAW_IDENTITY_DETAIL);
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

function identityWithoutPhone() {
  const data = parseAgentIdentityData({ ...RAW_IDENTITY_DETAIL, phone_number: null });
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

describe("AgentIdentity contact-rule delegation", () => {
  it("createMailContactRule delegates with the identity handle", async () => {
    const { identity, inkbox } = identityWithPhone();
    vi.mocked(inkbox._mailIdentityContactRules.create).mockResolvedValue(
      parseMailIdentityContactRule(MAIL_RULE_DICT),
    );

    const options = {
      action: MailRuleAction.BLOCK,
      matchType: MailRuleMatchType.EXACT_EMAIL,
      matchTarget: "spam@example.com",
    };
    await identity.createMailContactRule(options);

    expect(inkbox._mailIdentityContactRules.create).toHaveBeenCalledWith(
      identity.agentHandle,
      options,
    );
  });

  it("updateMailContactRule forwards rule id + options", async () => {
    const { identity, inkbox } = identityWithPhone();
    vi.mocked(inkbox._mailIdentityContactRules.update).mockResolvedValue(
      parseMailIdentityContactRule(MAIL_RULE_DICT),
    );

    await identity.updateMailContactRule("rid", { status: ContactRuleStatus.PAUSED });

    expect(inkbox._mailIdentityContactRules.update).toHaveBeenCalledWith(
      identity.agentHandle,
      "rid",
      { status: ContactRuleStatus.PAUSED },
    );
  });

  it("createPhoneContactRule delegates with the identity handle", async () => {
    const { identity, inkbox } = identityWithPhone();
    vi.mocked(inkbox._phoneIdentityContactRules.create).mockResolvedValue(
      parsePhoneIdentityContactRule(PHONE_RULE_DICT),
    );

    const options = { action: PhoneRuleAction.BLOCK, matchTarget: "+14155550199" };
    await identity.createPhoneContactRule(options);

    expect(inkbox._phoneIdentityContactRules.create).toHaveBeenCalledWith(
      identity.agentHandle,
      options,
    );
  });

  it("phone contact-rule methods throw when the identity has no phone number", async () => {
    const { identity, inkbox } = identityWithoutPhone();

    await expect(identity.listPhoneContactRules()).rejects.toThrow(InkboxError);
    await expect(
      identity.createPhoneContactRule({
        action: PhoneRuleAction.BLOCK,
        matchTarget: "+14155550199",
      }),
    ).rejects.toThrow(/no phone number/);
    expect(inkbox._phoneIdentityContactRules.list).not.toHaveBeenCalled();
    expect(inkbox._phoneIdentityContactRules.create).not.toHaveBeenCalled();
  });
});

describe("AgentIdentity signing-key delegation", () => {
  it("createSigningKey delegates with the identity handle", async () => {
    const { identity, inkbox } = identityWithPhone();
    vi.mocked(inkbox._signingKeys.createOrRotate).mockResolvedValue({
      signingKey: "sk",
      createdAt: new Date(),
    });

    await identity.createSigningKey();

    expect(inkbox._signingKeys.createOrRotate).toHaveBeenCalledWith(
      identity.agentHandle,
    );
  });

  it("getSigningKeyStatus delegates with the identity handle", async () => {
    const { identity, inkbox } = identityWithPhone();
    vi.mocked(inkbox._signingKeys.getStatus).mockResolvedValue({
      configured: true,
      createdAt: null,
    });

    await identity.getSigningKeyStatus();

    expect(inkbox._signingKeys.getStatus).toHaveBeenCalledWith(identity.agentHandle);
  });
});

describe("AgentIdentity.update filter modes", () => {
  it("sends mail/phone filter modes and the cached getters reflect the result", async () => {
    const { identity, inkbox } = identityWithPhone();
    const updated = parseAgentIdentitySummary({
      id: identity.id,
      organization_id: "org-abc123",
      agent_handle: identity.agentHandle,
      display_name: null,
      description: null,
      email_address: null,
      created_at: "2026-06-09T00:00:00Z",
      updated_at: "2026-06-09T00:00:00Z",
      imessage_enabled: false,
      imessage_filter_mode: "blacklist",
      mail_filter_mode: "whitelist",
      phone_filter_mode: "whitelist",
    });
    vi.mocked(inkbox._idsResource.update).mockResolvedValue(updated);

    await identity.update({ mailFilterMode: "whitelist", phoneFilterMode: "whitelist" });

    expect(inkbox._idsResource.update).toHaveBeenCalledWith(identity.agentHandle, {
      mailFilterMode: "whitelist",
      phoneFilterMode: "whitelist",
    });
    // Regression: the cache rebuild must not reset the modes to default.
    expect(identity.mailFilterMode).toBe(FilterMode.WHITELIST);
    expect(identity.phoneFilterMode).toBe(FilterMode.WHITELIST);
  });
});
