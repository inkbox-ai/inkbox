// sdk/typescript/tests/credentials.test.ts

import { describe, it, expect, vi } from "vitest";
import { Credentials } from "../src/credentials.js";
import { VaultSecretType } from "../src/vault/types.js";
import type {
  DecryptedVaultSecret,
  LoginPayload,
  APIKeyPayload,
  SSHKeyPayload,
  OtherPayload,
} from "../src/vault/types.js";
import { AgentIdentity } from "../src/agent_identity.js";
import { VaultResource, UnlockedVault } from "../src/vault/resources/vault.js";
import type { HttpTransport } from "../src/_http.js";
import type { _AgentIdentityData } from "../src/identities/types.js";
import type { Inkbox } from "../src/inkbox.js";

// -- Fixtures ---------------------------------------------------------------

const LOGIN_SECRET: DecryptedVaultSecret = {
  id: "aaaa0000-0000-0000-0000-000000000001",
  name: "GitHub Login",
  secretType: VaultSecretType.LOGIN,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  description: null,
  payload: { password: "s3cret", username: "admin", url: "https://github.com" } as LoginPayload,
};

const API_KEY_SECRET: DecryptedVaultSecret = {
  id: "bbbb0000-0000-0000-0000-000000000002",
  name: "OpenAI Key",
  secretType: VaultSecretType.API_KEY,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  description: null,
  payload: { apiKey: "sk-abc123", endpoint: "https://api.openai.com" } as APIKeyPayload,
};

const SSH_KEY_SECRET: DecryptedVaultSecret = {
  id: "cccc0000-0000-0000-0000-000000000003",
  name: "Prod Server",
  secretType: VaultSecretType.SSH_KEY,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  description: null,
  payload: { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----..." } as SSHKeyPayload,
};

const OTHER_SECRET: DecryptedVaultSecret = {
  id: "dddd0000-0000-0000-0000-000000000004",
  name: "Misc",
  secretType: VaultSecretType.OTHER,
  status: "active",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  description: null,
  payload: { data: "something" } as OtherPayload,
};

const ALL_SECRETS = [LOGIN_SECRET, API_KEY_SECRET, SSH_KEY_SECRET, OTHER_SECRET];

function makeCreds(secrets: DecryptedVaultSecret[] = ALL_SECRETS): Credentials {
  return new Credentials(secrets);
}

// -- Credentials unit tests -------------------------------------------------

describe("Credentials.list", () => {
  it("returns all secrets", () => {
    expect(makeCreds().list()).toHaveLength(4);
  });

  it("returns copy", () => {
    const creds = makeCreds();
    expect(creds.list()).not.toBe(creds.list());
  });
});

describe("Credentials.listLogins", () => {
  it("filters to login type", () => {
    const result = makeCreds().listLogins();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("GitHub Login");
  });
});

describe("Credentials.listApiKeys", () => {
  it("filters to api_key type", () => {
    const result = makeCreds().listApiKeys();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("OpenAI Key");
  });
});

describe("Credentials.listSshKeys", () => {
  it("filters to ssh_key type", () => {
    const result = makeCreds().listSshKeys();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Prod Server");
  });
});

describe("Credentials.get", () => {
  it("returns by UUID", () => {
    const secret = makeCreds().get("aaaa0000-0000-0000-0000-000000000001");
    expect(secret.name).toBe("GitHub Login");
  });

  it("throws for unknown UUID", () => {
    expect(() => makeCreds().get("00000000-0000-0000-0000-000000000099")).toThrow(
      "No credential with id",
    );
  });
});

describe("Credentials.getLogin", () => {
  it("returns typed LoginPayload", () => {
    const payload = makeCreds().getLogin("aaaa0000-0000-0000-0000-000000000001");
    expect((payload as LoginPayload).username).toBe("admin");
  });

  it("throws TypeError on wrong type", () => {
    expect(() =>
      makeCreds().getLogin("bbbb0000-0000-0000-0000-000000000002"),
    ).toThrow(TypeError);
  });
});

describe("Credentials.getApiKey", () => {
  it("returns typed APIKeyPayload", () => {
    const payload = makeCreds().getApiKey("bbbb0000-0000-0000-0000-000000000002");
    expect((payload as APIKeyPayload).apiKey).toBe("sk-abc123");
  });

  it("throws TypeError on wrong type", () => {
    expect(() =>
      makeCreds().getApiKey("aaaa0000-0000-0000-0000-000000000001"),
    ).toThrow(TypeError);
  });
});

describe("Credentials.getSshKey", () => {
  it("returns typed SSHKeyPayload", () => {
    const payload = makeCreds().getSshKey("cccc0000-0000-0000-0000-000000000003");
    expect((payload as SSHKeyPayload).privateKey).toBeDefined();
  });

  it("throws TypeError on wrong type", () => {
    expect(() =>
      makeCreds().getSshKey("aaaa0000-0000-0000-0000-000000000001"),
    ).toThrow(TypeError);
  });
});

describe("Credentials.length", () => {
  it("returns count", () => {
    expect(makeCreds().length).toBe(4);
    expect(makeCreds([]).length).toBe(0);
  });
});

describe("empty Credentials", () => {
  it("returns empty lists", () => {
    const creds = makeCreds([]);
    expect(creds.list()).toEqual([]);
    expect(creds.listLogins()).toEqual([]);
    expect(creds.listApiKeys()).toEqual([]);
    expect(creds.listSshKeys()).toEqual([]);
  });
});

// -- AgentIdentity.getCredentials integration --------------------------------

const IDENTITY_ID = "ee000000-0000-0000-0000-000000000001";

function mockIdentityData(): _AgentIdentityData {
  return {
    id: IDENTITY_ID,
    organizationId: "org_test_123",
    agentHandle: "test-bot",
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    mailbox: null,
    phoneNumber: null,
    authenticatorApp: null,
  };
}

function mockInkbox(options: {
  vaultUnlocked?: boolean;
  accessRules?: Array<{ identity_id: string }>
} = {}): Inkbox {
  const { vaultUnlocked = true, accessRules = [{ identity_id: IDENTITY_ID }] } = options;

  const http = {
    get: vi.fn().mockResolvedValue(accessRules),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;

  const vault = {
    http,
    _unlocked: vaultUnlocked
      ? { secrets: [...ALL_SECRETS] } as unknown as UnlockedVault
      : null,
  } as unknown as VaultResource;

  return {
    _vaultResource: vault,
    _idsResource: {
      get: vi.fn().mockResolvedValue(mockIdentityData()),
    },
  } as unknown as Inkbox;
}

describe("AgentIdentity.getCredentials", () => {
  it("throws when vault not unlocked", async () => {
    const identity = new AgentIdentity(mockIdentityData(), mockInkbox({ vaultUnlocked: false }));
    await expect(identity.getCredentials()).rejects.toThrow("Vault must be unlocked");
  });

  it("returns Credentials filtered by identity", async () => {
    const identity = new AgentIdentity(mockIdentityData(), mockInkbox());
    const creds = await identity.getCredentials();
    expect(creds).toBeInstanceOf(Credentials);
    expect(creds.length).toBe(4);
  });

  it("filters out inaccessible secrets", async () => {
    const identity = new AgentIdentity(
      mockIdentityData(),
      mockInkbox({ accessRules: [] }),
    );
    const creds = await identity.getCredentials();
    expect(creds.length).toBe(0);
  });

  it("caches credentials", async () => {
    const identity = new AgentIdentity(mockIdentityData(), mockInkbox());
    const creds1 = await identity.getCredentials();
    const creds2 = await identity.getCredentials();
    expect(creds1).toBe(creds2);
  });

  it("refresh clears cache", async () => {
    const inkbox = mockInkbox();
    const identity = new AgentIdentity(mockIdentityData(), inkbox);
    await identity.getCredentials();
    // @ts-expect-error -- accessing private for test
    expect(identity._credentials).not.toBeNull();
    await identity.refresh();
    // @ts-expect-error -- accessing private for test
    expect(identity._credentials).toBeNull();
  });

  it("revokeCredentialAccess calls revoke and clears cache", async () => {
    const inkbox = mockInkbox();
    const identity = new AgentIdentity(mockIdentityData(), inkbox);
    await identity.getCredentials();
    // @ts-expect-error -- accessing private for test
    expect(identity._credentials).not.toBeNull();
    (inkbox._vaultResource as any).revokeAccess = vi.fn().mockResolvedValue(undefined);
    await identity.revokeCredentialAccess("aaaa0000-0000-0000-0000-000000000001");
    expect((inkbox._vaultResource as any).revokeAccess).toHaveBeenCalledWith(
      "aaaa0000-0000-0000-0000-000000000001",
      IDENTITY_ID,
    );
    // @ts-expect-error -- accessing private for test
    expect(identity._credentials).toBeNull();
  });
});
