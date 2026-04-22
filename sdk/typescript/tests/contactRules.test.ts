// sdk/typescript/tests/contactRules.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { MailContactRulesResource } from "../src/mail/resources/contactRules.js";
import { PhoneContactRulesResource } from "../src/phone/resources/contactRules.js";
import {
  ContactRuleStatus,
  MailRuleAction,
  MailRuleMatchType,
} from "../src/mail/types.js";
import {
  PhoneRuleAction,
  PhoneRuleMatchType,
} from "../src/phone/types.js";

const BASE = "https://inkbox.ai/api/v1";

const MAIL_RULE_DICT = {
  id: "aaaa1111-0000-0000-0000-000000000011",
  mailbox_id: "bbbb2222-0000-0000-0000-000000000001",
  action: "block",
  match_type: "domain",
  match_target: "spam.example",
  status: "active",
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

const PHONE_RULE_DICT = {
  id: "aaaa1111-0000-0000-0000-000000000012",
  phone_number_id: "cccc3333-0000-0000-0000-000000000001",
  action: "block",
  match_type: "exact_number",
  match_target: "+15551234567",
  status: "active",
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get() { return null; },
      getSetCookie() { return []; },
    } as unknown as Headers,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("MailContactRulesResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create sends enum values as strings", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(MAIL_RULE_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new MailContactRulesResource(http);

    await resource.create("box@inkbox.ai", {
      action: MailRuleAction.BLOCK,
      matchType: MailRuleMatchType.DOMAIN,
      matchTarget: "spam.example",
    });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({
      action: "block",
      match_type: "domain",
      match_target: "spam.example",
    });
  });

  it("update only sends supplied fields", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ ...MAIL_RULE_DICT, status: "paused" }));
    const http = new HttpTransport("k", BASE);
    const resource = new MailContactRulesResource(http);

    await resource.update("box@inkbox.ai", "aaaa1111-0000-0000-0000-000000000011", {
      status: ContactRuleStatus.PAUSED,
    });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ status: "paused" });
  });

  it("listAll hits /contact-rules with mailboxId param", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([MAIL_RULE_DICT]));
    const http = new HttpTransport("k", BASE);
    const resource = new MailContactRulesResource(http);

    await resource.listAll({ mailboxId: "bbbb2222-0000-0000-0000-000000000001" });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("/contact-rules");
    expect(url).toContain("mailbox_id=bbbb2222");
  });

  it("listAll forwards action + match_type filters", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([MAIL_RULE_DICT]));
    const http = new HttpTransport("k", BASE);
    const resource = new MailContactRulesResource(http);

    await resource.listAll({
      action: MailRuleAction.BLOCK,
      matchType: MailRuleMatchType.DOMAIN,
    });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("action=block");
    expect(url).toContain("match_type=domain");
  });
});

describe("PhoneContactRulesResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create defaults matchType to exact_number", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(PHONE_RULE_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new PhoneContactRulesResource(http);

    await resource.create("cccc3333-0000-0000-0000-000000000001", {
      action: PhoneRuleAction.BLOCK,
      matchTarget: "+15551234567",
    });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.match_type).toBe("exact_number");
    expect(body.action).toBe("block");
  });
});
