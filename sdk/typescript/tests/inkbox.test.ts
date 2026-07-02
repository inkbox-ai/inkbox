// sdk/typescript/tests/inkbox.test.ts
import { describe, it, expect, vi } from "vitest";
import { Inkbox } from "../src/inkbox.js";
import { MailboxesResource } from "../src/mail/resources/mailboxes.js";
import { MessagesResource } from "../src/mail/resources/messages.js";
import { ThreadsResource } from "../src/mail/resources/threads.js";
import { PhoneNumbersResource } from "../src/phone/resources/numbers.js";
import { CallsResource } from "../src/phone/resources/calls.js";
import { TextsResource } from "../src/phone/resources/texts.js";
import { IncomingCallActionResource } from "../src/phone/resources/incomingCallAction.js";
import { IdentitiesResource } from "../src/identities/resources/identities.js";
import { AgentIdentity } from "../src/agent_identity.js";
import { VaultResource } from "../src/vault/resources/vault.js";
import { RAW_IDENTITY, RAW_IDENTITY_DETAIL, RAW_SIGNING_KEY } from "./sampleData.js";

function makeInkbox() {
  return new Inkbox({ apiKey: "test-key", baseUrl: "https://test.inkbox.ai" });
}

describe("Inkbox constructor", () => {
  it("shares cookies across transports within one client", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: () => "AWSALB=shared-cookie; Path=/api; HttpOnly",
          getSetCookie: () => ["AWSALB=shared-cookie; Path=/api; HttpOnly"],
        },
        json: () => Promise.resolve({ ok: true }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get: () => null,
          getSetCookie: () => [],
        },
        json: () => Promise.resolve({ ok: true }),
      } as unknown as Response);

    const ink = makeInkbox();

    await ink._rootApiHttp.get("/first");
    await (ink._idsResource as unknown as { http: { get: (path: string) => Promise<unknown> } }).http.get("/second");

    const [, secondInit] = vi.mocked(fetch).mock.calls[1];
    expect((secondInit!.headers as Record<string, string>).Cookie).toBe("AWSALB=shared-cookie");

    vi.restoreAllMocks();
  });

  it("exposes mailboxes accessor", () => {
    const ink = makeInkbox();
    expect(ink.mailboxes).toBeInstanceOf(MailboxesResource);
  });

  it("exposes mail messages and threads accessors", () => {
    const ink = makeInkbox();
    expect(ink.messages).toBeInstanceOf(MessagesResource);
    expect(ink.threads).toBeInstanceOf(ThreadsResource);
  });

  it("exposes phoneNumbers accessor", () => {
    const ink = makeInkbox();
    expect(ink.phoneNumbers).toBeInstanceOf(PhoneNumbersResource);
  });

  it("exposes phone calls, texts, and incomingCallAction accessors", () => {
    const ink = makeInkbox();
    expect(ink.calls).toBeInstanceOf(CallsResource);
    expect(ink.texts).toBeInstanceOf(TextsResource);
    expect(ink.incomingCallAction).toBeInstanceOf(IncomingCallActionResource);
  });

  it("has no transcripts accessor (removed in the identity-centered phone rework)", () => {
    const ink = makeInkbox();
    expect("transcripts" in ink).toBe(false);
    expect(Object.getOwnPropertyDescriptor(Inkbox.prototype, "transcripts")).toBeUndefined();
  });

  it("phoneNumbers resource has no number-scoped call methods", () => {
    // Call/transcript access is identity-centered on inkbox.calls now.
    const proto = PhoneNumbersResource.prototype as unknown as Record<string, unknown>;
    for (const removed of ["listCalls", "getCall", "placeCall", "listTranscripts", "getTranscript", "calls", "transcripts"]) {
      expect(proto[removed]).toBeUndefined();
    }
  });

  it("strips trailing slash from baseUrl", () => {
    const ink = new Inkbox({ apiKey: "key", baseUrl: "https://test.inkbox.ai/" });
    expect(ink.mailboxes).toBeInstanceOf(MailboxesResource);
  });

  it("uses default baseUrl when not provided", () => {
    const ink = new Inkbox({ apiKey: "key" });
    expect(ink.mailboxes).toBeInstanceOf(MailboxesResource);
  });

  it("rejects non-HTTPS baseUrl", () => {
    expect(() => new Inkbox({ apiKey: "key", baseUrl: "http://example.com" })).toThrow(
      "Only HTTPS base URLs are permitted",
    );
  });

  it("allows HTTP for localhost", () => {
    expect(() => new Inkbox({ apiKey: "key", baseUrl: "http://localhost:8000" })).not.toThrow();
  });

  it("allows HTTP for 127.0.0.1", () => {
    expect(() => new Inkbox({ apiKey: "key", baseUrl: "http://127.0.0.1:8000" })).not.toThrow();
  });
});

describe("Inkbox.createIdentity", () => {
  function mockCreateReturnsDetail(ink: Inkbox) {
    vi.spyOn(ink._idsResource, "create").mockResolvedValue({
      id: RAW_IDENTITY_DETAIL.id,
      organizationId: RAW_IDENTITY_DETAIL.organization_id,
      agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
      displayName: null,
      description: null,
      emailAddress: RAW_IDENTITY_DETAIL.email_address,
      createdAt: RAW_IDENTITY_DETAIL.created_at,
      updatedAt: RAW_IDENTITY_DETAIL.updated_at,
      mailbox: null,
      phoneNumber: null,
      tunnel: null,
    });
  }

  it("creates with a single POST (no follow-up GET) and returns the parsed detail", async () => {
    const ink = makeInkbox();
    mockCreateReturnsDetail(ink);
    const getSpy = vi.spyOn(ink._idsResource, "get");

    const identity = await ink.createIdentity("sales-agent");

    expect(ink._idsResource.create).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
    expect(identity).toBeInstanceOf(AgentIdentity);
    expect(identity.agentHandle).toBe(RAW_IDENTITY_DETAIL.agent_handle);
  });

  it("maps displayName, description, tunnel, phone, and vault secrets into the create payload", async () => {
    const ink = makeInkbox();
    mockCreateReturnsDetail(ink);

    await ink.createIdentity("sales-agent", {
      displayName: "Sales Team",
      description: "Sales-outreach agent",
      emailLocalPart: "sales.team",
      tunnel: { tlsMode: "passthrough" },
      phoneNumber: {
        incomingCallAction: "webhook",
        incomingCallWebhookUrl: "https://example.com/calls",
      },
      vaultSecretIds: ["secret-1", "secret-2"],
    });

    const call = vi.mocked(ink._idsResource.create).mock.calls[0][0];
    expect(call.agentHandle).toBe("sales-agent");
    expect(call.displayName).toBe("Sales Team");
    expect(call.description).toBe("Sales-outreach agent");
    expect(call.mailbox).toEqual({ emailLocalPart: "sales.team" });
    expect(call.tunnel).toEqual({ tlsMode: "passthrough" });
    expect(call.phoneNumber).toEqual({
      incomingCallAction: "webhook",
      incomingCallWebhookUrl: "https://example.com/calls",
    });
    expect(call.vaultSecretIds).toEqual(["secret-1", "secret-2"]);
  });

  it("forwards sendingDomain when set (string or explicit null)", async () => {
    const ink = makeInkbox();
    mockCreateReturnsDetail(ink);

    await ink.createIdentity("sales-agent", { sendingDomain: "mail.acme.com" });
    let call = vi.mocked(ink._idsResource.create).mock.calls[0][0];
    expect(call.mailbox?.sendingDomain).toBe("mail.acme.com");

    vi.mocked(ink._idsResource.create).mockClear();
    await ink.createIdentity("sales-agent", { sendingDomain: null });
    call = vi.mocked(ink._idsResource.create).mock.calls[0][0];
    expect(call.mailbox).toBeDefined();
    expect(call.mailbox?.sendingDomain).toBeNull();
  });
});

describe("Inkbox.getIdentity", () => {
  it("returns AgentIdentity", async () => {
    const ink = makeInkbox();
    vi.spyOn(ink._idsResource, "get").mockResolvedValue({
      id: RAW_IDENTITY_DETAIL.id,
      organizationId: RAW_IDENTITY_DETAIL.organization_id,
      agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
      emailAddress: RAW_IDENTITY_DETAIL.email_address,
      createdAt: RAW_IDENTITY_DETAIL.created_at,
      updatedAt: RAW_IDENTITY_DETAIL.updated_at,
      mailbox: null,
      phoneNumber: null,
    });

    const identity = await ink.getIdentity("sales-agent");

    expect(identity).toBeInstanceOf(AgentIdentity);
    expect(identity.agentHandle).toBe("sales-agent");
  });
});

describe("Inkbox.listIdentities", () => {
  it("delegates to IdentitiesResource.list", async () => {
    const ink = makeInkbox();
    const summaries = [
      {
        id: RAW_IDENTITY.id,
        organizationId: RAW_IDENTITY.organization_id,
        agentHandle: RAW_IDENTITY.agent_handle,
        emailAddress: RAW_IDENTITY.email_address,
        createdAt: RAW_IDENTITY.created_at,
        updatedAt: RAW_IDENTITY.updated_at,
      },
    ];
    vi.spyOn(ink._idsResource, "list").mockResolvedValue(summaries);

    const result = await ink.listIdentities();

    expect(result).toEqual(summaries);
  });
});

describe("Inkbox vaultKey option", () => {
  it("triggers vault.unlock when provided", () => {
    const spy = vi.spyOn(VaultResource.prototype, "unlock").mockResolvedValue({} as any);
    const ink = new Inkbox({ apiKey: "test-key", baseUrl: "https://test.inkbox.ai", vaultKey: "my-Vault-key-01!" });
    expect(spy).toHaveBeenCalledWith("my-Vault-key-01!");
    expect(ink._vaultUnlockPromise).not.toBeNull();
    spy.mockRestore();
  });

  it("does not trigger unlock when omitted", () => {
    const ink = makeInkbox();
    expect(ink._vaultUnlockPromise).toBeNull();
  });
});

describe("Inkbox.ready()", () => {
  it("resolves to the Inkbox instance when vault unlock succeeds", async () => {
    const spy = vi.spyOn(VaultResource.prototype, "unlock").mockResolvedValue({} as any);
    const ink = new Inkbox({ apiKey: "test-key", baseUrl: "https://test.inkbox.ai", vaultKey: "my-Vault-key-01!" });

    const result = await ink.ready();

    expect(result).toBe(ink);
    spy.mockRestore();
  });

  it("throws when vault unlock fails", async () => {
    const spy = vi.spyOn(VaultResource.prototype, "unlock").mockRejectedValue(new Error("bad key"));
    const ink = new Inkbox({ apiKey: "test-key", baseUrl: "https://test.inkbox.ai", vaultKey: "wrong-key" });

    await expect(ink.ready()).rejects.toThrow("bad key");
    spy.mockRestore();
  });

  it("resolves immediately when no vaultKey provided", async () => {
    const ink = makeInkbox();

    const result = await ink.ready();

    expect(result).toBe(ink);
  });
});

describe("Inkbox.createSigningKey", () => {
  it("delegates to SigningKeysResource", async () => {
    const ink = makeInkbox();
    vi.spyOn(ink._signingKeys, "createOrRotate").mockResolvedValue({
      signingKey: RAW_SIGNING_KEY.signing_key,
      createdAt: RAW_SIGNING_KEY.created_at,
    });

    const key = await ink.createSigningKey();

    expect(key.signingKey).toBe(RAW_SIGNING_KEY.signing_key);
  });
});
