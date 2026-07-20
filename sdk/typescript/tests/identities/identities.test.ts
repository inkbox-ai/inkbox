// sdk/typescript/tests/identities/identities.test.ts
import { describe, it, expect, vi } from "vitest";
import { IdentitiesResource } from "../../src/identities/resources/identities.js";
import type { HttpTransport } from "../../src/_http.js";
import { IMessageNumberType } from "../../src/imessage/types.js";
import {
  RAW_IDENTITY,
  RAW_IDENTITY_DETAIL,
  RAW_IDENTITY_LIST_DETAIL,
  RAW_IDENTITY_ACCESS_WILDCARD,
  RAW_IDENTITY_ACCESS_VIEWER,
} from "../sampleData.js";

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

  it("supports nested mailbox, phone number, and vault secret payloads", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      ...RAW_IDENTITY,
      email_address: "sales.team@inkboxmail.com",
    });
    const res = new IdentitiesResource(http);

    const identity = await res.create({
      agentHandle: HANDLE,
      displayName: "Sales Team",
      description: "Sales outreach",
      mailbox: {
        emailLocalPart: "sales.team",
      },
      tunnel: { tlsMode: "passthrough" },
      phoneNumber: {
        type: "local",
        state: "NY",
        incomingCallAction: "webhook",
        incomingCallWebhookUrl: "https://example.com/calls",
      },
      vaultSecretIds: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });

    expect(http.post).toHaveBeenCalledWith("/", {
      agent_handle: HANDLE,
      display_name: "Sales Team",
      description: "Sales outreach",
      mailbox: {
        email_local_part: "sales.team",
      },
      tunnel: { tls_mode: "passthrough" },
      phone_number: {
        type: "local",
        state: "NY",
        incoming_call_action: "webhook",
        incoming_call_webhook_url: "https://example.com/calls",
      },
      vault_secret_ids: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });
    expect(identity.emailAddress).toBe("sales.team@inkboxmail.com");
  });

  it("supports a single vault secret ID", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.create({
      agentHandle: HANDLE,
      vaultSecretIds: "11111111-1111-1111-1111-111111111111",
    });

    expect(http.post).toHaveBeenCalledWith("/", {
      agent_handle: HANDLE,
      vault_secret_ids: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("claims and attaches a dedicated iMessage number during create", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY_DETAIL);
    const res = new IdentitiesResource(http);

    const identity = await res.create({
      agentHandle: HANDLE,
      imessageEnabled: true,
      imessageNumberType: IMessageNumberType.DEDICATED_OUTBOUND,
    });

    expect(http.post).toHaveBeenCalledWith("/", {
      agent_handle: HANDLE,
      imessage_enabled: true,
      imessage_number_type: "dedicated_outbound",
    });
    expect(identity.imessageNumber?.type).toBe("dedicated_outbound");
  });

  it("requires iMessage to be enabled when claiming during create", async () => {
    const http = mockHttp();
    const res = new IdentitiesResource(http);

    await expect(res.create({
      agentHandle: HANDLE,
      imessageNumberType: IMessageNumberType.DEDICATED_INBOUND,
    })).rejects.toThrow("imessageNumberType requires imessageEnabled: true");
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe("IdentitiesResource.list", () => {
  it("preserves hydrated fields", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_IDENTITY_LIST_DETAIL]);
    const res = new IdentitiesResource(http);

    const identities = await res.list();

    expect(http.get).toHaveBeenCalledWith("/");
    expect(identities).toHaveLength(1);
    expect(identities[0].agentHandle).toBe(HANDLE);
    expect(identities[0].mailbox?.emailAddress).toBe("sales-agent@inkbox.ai");
    expect(identities[0].tunnel?.tunnelName).toBe(HANDLE);
    expect(identities[0].access?.[0].viewerIdentityId).toBeNull();
  });

  it("accepts older summary responses", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_IDENTITY]);
    const res = new IdentitiesResource(http);

    const identity = (await res.list())[0];

    expect(identity.agentHandle).toBe(HANDLE);
    expect(identity.mailbox).toBeNull();
    expect(identity.tunnel).toBeNull();
    expect(identity.access).toEqual([]);
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

  it("omits undefined fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, { newHandle: "new-handle" });

    const [, body] = vi.mocked(http.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["agent_handle"]).toBe("new-handle");
  });

  it("claims a dedicated number during update with a stable idempotency key", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, {
      imessageNumberType: IMessageNumberType.DEDICATED_INBOUND,
      idempotencyKey: "identity-claim-123",
    });

    expect(http.patch).toHaveBeenCalledWith(
      `/${HANDLE}`,
      { imessage_number_type: "dedicated_inbound" },
      { headers: { "Idempotency-Key": "identity-claim-123" } },
    );
  });

  it("forwards a caller-provided idempotency key on other updates", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, {
      displayName: "Updated",
      idempotencyKey: "profile-update-123",
    });

    expect(http.patch).toHaveBeenCalledWith(
      `/${HANDLE}`,
      { display_name: "Updated" },
      { headers: { "Idempotency-Key": "profile-update-123" } },
    );
  });

  it("requires and validates the idempotency key for an update claim", async () => {
    const http = mockHttp();
    const res = new IdentitiesResource(http);

    await expect(res.update(HANDLE, {
      imessageNumberType: IMessageNumberType.DEDICATED_OUTBOUND,
    })).rejects.toThrow("idempotencyKey is required with imessageNumberType");
    await expect(res.update(HANDLE, {
      imessageNumberType: IMessageNumberType.DEDICATED_OUTBOUND,
      idempotencyKey: "x".repeat(256),
    })).rejects.toThrow("between 1 and 255 characters");
    expect(http.patch).not.toHaveBeenCalled();
  });

  it("rejects incompatible identity number changes", async () => {
    const http = mockHttp();
    const res = new IdentitiesResource(http);

    await expect(res.update(HANDLE, {
      imessageNumberType: IMessageNumberType.DEDICATED_INBOUND,
      imessageNumberId: "99999999-0000-0000-0000-000000000001",
      idempotencyKey: "identity-claim-123",
    })).rejects.toThrow("imessageNumberType and imessageNumberId cannot be set together");
    await expect(res.update(HANDLE, {
      imessageEnabled: false,
      imessageNumberType: IMessageNumberType.DEDICATED_INBOUND,
      idempotencyKey: "identity-claim-456",
    })).rejects.toThrow("cannot be combined with disabling iMessage");
    expect(http.patch).not.toHaveBeenCalled();
  });

  it("preserves explicit null when moving back to shared iMessage", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, { imessageNumberId: null });

    expect(http.patch).toHaveBeenCalledWith(`/${HANDLE}`, {
      imessage_number_id: null,
    });
  });

  it("allows disabling iMessage while explicitly returning to shared service", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_IDENTITY_DETAIL);
    const res = new IdentitiesResource(http);

    await res.update(HANDLE, {
      imessageEnabled: false,
      imessageNumberId: null,
    });

    expect(http.patch).toHaveBeenCalledWith(`/${HANDLE}`, {
      imessage_enabled: false,
      imessage_number_id: null,
    });
  });

  it("passes through number attachment conflicts without remapping them as handle errors", async () => {
    const http = mockHttp();
    const { InkboxAPIError } = await import("../../src/_http.js");
    vi.mocked(http.patch).mockRejectedValue(new InkboxAPIError(409, {
      error: "number_already_attached",
      message: "Choose another number.",
    }));
    const res = new IdentitiesResource(http);

    const err = await res.update(HANDLE, {
      imessageNumberId: "99999999-0000-0000-0000-000000000001",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InkboxAPIError);
    expect(err).toMatchObject({ name: "InkboxAPIError" });
  });

  it("still maps an actual handle collision", async () => {
    const http = mockHttp();
    const { InkboxAPIError } = await import("../../src/_http.js");
    const { HandleUnavailableError } = await import("../../src/identities/exceptions.js");
    vi.mocked(http.patch).mockRejectedValue(new InkboxAPIError(409, {
      code: "agent_handle_unavailable",
      message: "That handle is unavailable.",
      blocking_namespace: "identities",
    }));
    const res = new IdentitiesResource(http);

    const err = await res.update(HANDLE, {
      newHandle: "already-used",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HandleUnavailableError);
    expect(err).toMatchObject({ blockingNamespace: "identities" });
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


describe("IdentitiesResource.releasePhoneNumber", () => {
  it("releases the identity's phone number", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new IdentitiesResource(http);

    await res.releasePhoneNumber(HANDLE);

    expect(http.delete).toHaveBeenCalledWith(`/${HANDLE}/phone_number`);
  });
});

describe("IdentitiesResource.listAccess", () => {
  it("lists per-viewer access rows", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_IDENTITY_ACCESS_VIEWER]);
    const res = new IdentitiesResource(http);

    const rows = await res.listAccess(HANDLE);

    expect(http.get).toHaveBeenCalledWith(`/${HANDLE}/access`);
    expect(rows).toHaveLength(1);
    expect(rows[0].viewerIdentityId).toBe("dddd4444-0000-0000-0000-000000000001");
    expect(rows[0].targetIdentityId).toBe("eeee5555-0000-0000-0000-000000000001");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("parses the wildcard row with a null viewer", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_IDENTITY_ACCESS_WILDCARD]);
    const res = new IdentitiesResource(http);

    const rows = await res.listAccess(HANDLE);

    expect(rows[0].viewerIdentityId).toBeNull();
  });

  it("returns an empty list when no agent can see the identity", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new IdentitiesResource(http);

    expect(await res.listAccess(HANDLE)).toEqual([]);
  });
});

describe("IdentitiesResource.grantAccess", () => {
  it("grants a per-viewer access row", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY_ACCESS_VIEWER);
    const res = new IdentitiesResource(http);

    const grant = await res.grantAccess(
      HANDLE,
      "dddd4444-0000-0000-0000-000000000001",
    );

    expect(http.post).toHaveBeenCalledWith(`/${HANDLE}/access`, {
      viewer_identity_id: "dddd4444-0000-0000-0000-000000000001",
    });
    expect(grant.viewerIdentityId).toBe("dddd4444-0000-0000-0000-000000000001");
  });

  it("resets to the org-wide wildcard when viewerIdentityId is null", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_IDENTITY_ACCESS_WILDCARD);
    const res = new IdentitiesResource(http);

    const grant = await res.grantAccess(HANDLE, null);

    expect(http.post).toHaveBeenCalledWith(`/${HANDLE}/access`, {
      viewer_identity_id: null,
    });
    expect(grant.viewerIdentityId).toBeNull();
  });
});

describe("IdentitiesResource.revokeAccess", () => {
  it("revokes a viewer keyed by the viewer identity UUID", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new IdentitiesResource(http);

    await res.revokeAccess(HANDLE, "dddd4444-0000-0000-0000-000000000001");

    expect(http.delete).toHaveBeenCalledWith(
      `/${HANDLE}/access/dddd4444-0000-0000-0000-000000000001`,
    );
  });
});
