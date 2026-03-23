// sdk/typescript/tests/inkbox.test.ts
import { describe, it, expect, vi } from "vitest";
import { Inkbox } from "../src/inkbox.js";
import { MailboxesResource } from "../src/mail/resources/mailboxes.js";
import { PhoneNumbersResource } from "../src/phone/resources/numbers.js";
import { IdentitiesResource } from "../src/identities/resources/identities.js";
import { AgentIdentity } from "../src/agent_identity.js";
import { VaultResource } from "../src/vault/resources/vault.js";
import { RAW_IDENTITY, RAW_IDENTITY_DETAIL, RAW_SIGNING_KEY } from "./sampleData.js";

function makeInkbox() {
  return new Inkbox({ apiKey: "test-key", baseUrl: "https://test.inkbox.ai" });
}

describe("Inkbox constructor", () => {
  it("exposes mailboxes accessor", () => {
    const ink = makeInkbox();
    expect(ink.mailboxes).toBeInstanceOf(MailboxesResource);
  });

  it("exposes phoneNumbers accessor", () => {
    const ink = makeInkbox();
    expect(ink.phoneNumbers).toBeInstanceOf(PhoneNumbersResource);
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
  it("creates and fetches full identity detail", async () => {
    const ink = makeInkbox();
    vi.spyOn(ink._idsResource, "create").mockResolvedValue({
      id: RAW_IDENTITY.id,
      agentHandle: RAW_IDENTITY.agent_handle,
      status: RAW_IDENTITY.status,
      createdAt: RAW_IDENTITY.created_at,
      updatedAt: RAW_IDENTITY.updated_at,
    });
    vi.spyOn(ink._idsResource, "get").mockResolvedValue({
      id: RAW_IDENTITY_DETAIL.id,
      agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
      status: RAW_IDENTITY_DETAIL.status,
      createdAt: RAW_IDENTITY_DETAIL.created_at,
      updatedAt: RAW_IDENTITY_DETAIL.updated_at,
      mailbox: {
        id: RAW_IDENTITY_DETAIL.mailbox.id,
        emailAddress: RAW_IDENTITY_DETAIL.mailbox.email_address,
        displayName: RAW_IDENTITY_DETAIL.mailbox.display_name,
        status: RAW_IDENTITY_DETAIL.mailbox.status,
        createdAt: RAW_IDENTITY_DETAIL.mailbox.created_at,
        updatedAt: RAW_IDENTITY_DETAIL.mailbox.updated_at,
      },
      phoneNumber: {
        id: RAW_IDENTITY_DETAIL.phone_number.id,
        number: RAW_IDENTITY_DETAIL.phone_number.number,
        type: RAW_IDENTITY_DETAIL.phone_number.type,
        status: RAW_IDENTITY_DETAIL.phone_number.status,
        incomingCallAction: RAW_IDENTITY_DETAIL.phone_number.incoming_call_action,
        clientWebsocketUrl: RAW_IDENTITY_DETAIL.phone_number.client_websocket_url,
        createdAt: RAW_IDENTITY_DETAIL.phone_number.created_at,
        updatedAt: RAW_IDENTITY_DETAIL.phone_number.updated_at,
      },
    });

    const identity = await ink.createIdentity("sales-agent");

    expect(ink._idsResource.create).toHaveBeenCalledWith({ agentHandle: "sales-agent" });
    expect(ink._idsResource.get).toHaveBeenCalledWith("sales-agent");
    expect(identity).toBeInstanceOf(AgentIdentity);
    expect(identity.agentHandle).toBe("sales-agent");
  });
});

describe("Inkbox.getIdentity", () => {
  it("returns AgentIdentity", async () => {
    const ink = makeInkbox();
    vi.spyOn(ink._idsResource, "get").mockResolvedValue({
      id: RAW_IDENTITY_DETAIL.id,
      agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
      status: RAW_IDENTITY_DETAIL.status,
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
        agentHandle: RAW_IDENTITY.agent_handle,
        status: RAW_IDENTITY.status,
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
