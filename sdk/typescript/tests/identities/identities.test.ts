// sdk/typescript/tests/identities/identities.test.ts
import { describe, it, expect, vi } from "vitest";
import { IdentitiesResource } from "../../src/identities/resources/identities.js";
import type { HttpTransport } from "../../src/_http.js";
import { VaultKeyType } from "../../src/vault/types.js";
import { RAW_IDENTITY, RAW_IDENTITY_DETAIL } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const HANDLE = "sales-agent";

describe("IdentitiesResource.create", () => {
  it("posts and returns AgentIdentity", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    const identity = await res.create({ agentHandle: HANDLE });

    expect(http.post).toHaveBeenCalledWith("/", { agent_handle: HANDLE });
    expect(identity.agentHandle).toBe(HANDLE);
  });

  it("supports nested mailbox and vault payloads", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_IDENTITY,
      email_address: "sales.team@inkboxmail.com",
    });
    const res = new IdentitiesResource(http);

    const identity = await res.create({
      agentHandle: HANDLE,
      mailbox: {
        displayName: "Sales Team",
        emailLocalPart: "sales.team",
      },
      vault: {
        vaultKey: {
          id: "11111111-1111-1111-1111-111111111111",
          wrappedOrgEncryptionKey: "wrapped-primary",
          authHash: "auth-primary",
          keyType: VaultKeyType.PRIMARY,
        },
        recoveryKeys: Array.from({ length: 4 }, (_, i) => ({
          id: `22222222-2222-2222-2222-22222222222${i}`,
          wrappedOrgEncryptionKey: `wrapped-recovery-${i}`,
          authHash: `auth-recovery-${i}`,
          keyType: VaultKeyType.RECOVERY,
        })),
      },
    });

    expect(http.post).toHaveBeenCalledWith("/", {
      agent_handle: HANDLE,
      mailbox: {
        display_name: "Sales Team",
        email_local_part: "sales.team",
      },
      vault: {
        vault_key: {
          id: "11111111-1111-1111-1111-111111111111",
          wrapped_org_encryption_key: "wrapped-primary",
          auth_hash: "auth-primary",
          key_type: "primary",
        },
        recovery_keys: Array.from({ length: 4 }, (_, i) => ({
          id: `22222222-2222-2222-2222-22222222222${i}`,
          wrapped_org_encryption_key: `wrapped-recovery-${i}`,
          auth_hash: `auth-recovery-${i}`,
          key_type: "recovery",
        })),
      },
    });
    expect(identity.emailAddress).toBe("sales.team@inkboxmail.com");
  });
});

describe("IdentitiesResource.list", () => {
  it("returns list of identities", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_IDENTITY]);
    const res = new IdentitiesResource(http);

    const identities = await res.list();

    expect(http.get).toHaveBeenCalledWith("/");
    expect(identities).toHaveLength(1);
    expect(identities[0].agentHandle).toBe(HANDLE);
  });

  it("returns empty list", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new IdentitiesResource(http);
    expect(await res.list()).toEqual([]);
  });
});

describe("IdentitiesResource.get", () => {
  it("returns AgentIdentityDetail", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_IDENTITY_DETAIL);
    const res = new IdentitiesResource(http);

    const detail = await res.get(HANDLE);

    expect(http.get).toHaveBeenCalledWith(`/${HANDLE}`);
    expect(detail.mailbox!.emailAddress).toBe("sales-agent@inkbox.ai");
  });
});

describe("IdentitiesResource.update", () => {
  it("sends newHandle", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({ ...RAW_IDENTITY, agent_handle: "new-handle" });
    const res = new IdentitiesResource(http);

    const result = await res.update(HANDLE, { newHandle: "new-handle" });

    expect(http.patch).toHaveBeenCalledWith(`/${HANDLE}`, { agent_handle: "new-handle" });
    expect(result.agentHandle).toBe("new-handle");
  });

  it("sends status", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({ ...RAW_IDENTITY, status: "paused" });
    const res = new IdentitiesResource(http);

    const result = await res.update(HANDLE, { status: "paused" });

    expect(http.patch).toHaveBeenCalledWith(`/${HANDLE}`, { status: "paused" });
    expect(result.status).toBe("paused");
  });

  it("omits undefined fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, { status: "active" });

    const [, body] = vi.mocked(http.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["agent_handle"]).toBeUndefined();
  });
});

describe("IdentitiesResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new IdentitiesResource(http);

    await res.delete(HANDLE);

    expect(http.delete).toHaveBeenCalledWith(`/${HANDLE}`);
  });
});

describe("IdentitiesResource.assignMailbox", () => {
  it("posts mailbox_id and returns detail", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY_DETAIL);
    const res = new IdentitiesResource(http);
    const mailboxId = "aaaa1111-0000-0000-0000-000000000001";

    const detail = await res.assignMailbox(HANDLE, { mailboxId });

    expect(http.post).toHaveBeenCalledWith(`/${HANDLE}/mailbox`, { mailbox_id: mailboxId });
    expect(detail.mailbox!.emailAddress).toBe("sales-agent@inkbox.ai");
  });
});

describe("IdentitiesResource.unlinkMailbox", () => {
  it("deletes mailbox link", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new IdentitiesResource(http);

    await res.unlinkMailbox(HANDLE);

    expect(http.delete).toHaveBeenCalledWith(`/${HANDLE}/mailbox`);
  });
});

describe("IdentitiesResource.assignPhoneNumber", () => {
  it("posts phone_number_id and returns detail", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY_DETAIL);
    const res = new IdentitiesResource(http);
    const phoneNumberId = "bbbb2222-0000-0000-0000-000000000001";

    const detail = await res.assignPhoneNumber(HANDLE, { phoneNumberId });

    expect(http.post).toHaveBeenCalledWith(`/${HANDLE}/phone_number`, {
      phone_number_id: phoneNumberId,
    });
    expect(detail.phoneNumber!.number).toBe("+18335794607");
  });
});

describe("IdentitiesResource.unlinkPhoneNumber", () => {
  it("deletes phone number link", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new IdentitiesResource(http);

    await res.unlinkPhoneNumber(HANDLE);

    expect(http.delete).toHaveBeenCalledWith(`/${HANDLE}/phone_number`);
  });
});
