import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Inkbox, InkboxAPIError, type ResponseMetadata } from "../src/index.js";
import { UnlockedVault } from "../src/vault/resources/vault.js";
import { deriveMasterKey, deriveSalt, encryptPayload, generateOrgEncryptionKey, wrapOrgKey } from "../src/vault/crypto.js";
import { VaultSecretType, serializePayload, type DecryptedVaultSecret } from "../src/vault/types.js";

const vaultKey = "Example-Vault-Key-01!";
const orgKey = generateOrgEncryptionKey();
const agent = {
  id: "identity-1", agent_handle: "example-agent", organization_id: "org-example",
  mailbox: null, phone_number: null, tunnel: null,
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
let wrappedKey: string;

beforeAll(async () => {
  wrappedKey = wrapOrgKey(await deriveMasterKey(vaultKey, deriveSalt(agent.organization_id)), orgKey, "key-1");
});
afterEach(() => vi.restoreAllMocks());

function secret(id: string): DecryptedVaultSecret {
  return {
    id, name: `Secret ${id}`, description: null, secretType: VaultSecretType.LOGIN,
    createdAt: new Date(agent.created_at), updatedAt: new Date(agent.updated_at),
    payload: { username: "example", password: "example-password" },
  };
}

function wire(value: DecryptedVaultSecret) {
  return {
    id: value.id, name: value.name, description: value.description, secret_type: value.secretType,
    created_at: value.createdAt.toISOString(), updated_at: value.updatedAt.toISOString(),
    encrypted_payload: encryptPayload(orgKey, serializePayload(value.secretType, value.payload), value.id),
  };
}

function headers(code: string) {
  return { "Inkbox-Notices": JSON.stringify([{ code, level: "info", message: code }]) };
}

function mockVaultFetch(secrets: DecryptedVaultSecret[] = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const metadata = headers(`${init?.method ?? "GET"}:${path}`);
    if (path.endsWith("/info")) return Response.json({
      id: "vault-1", organization_id: agent.organization_id,
      created_at: agent.created_at, updated_at: agent.updated_at,
      key_count: 1, secret_count: secrets.length, recovery_key_count: 0,
    }, { headers: metadata });
    if (path.endsWith("/unlock")) return Response.json({
      wrapped_org_encryption_key: wrappedKey, encrypted_secrets: secrets.map(wire),
    }, { headers: metadata });
    if (path.endsWith("/keys")) return Response.json([{ id: "key-1" }], { headers: metadata });
    if (path.endsWith("/identities/example-agent")) return Response.json(agent, { headers: metadata });
    if (init?.method === "DELETE") return new Response(null, { status: 204, headers: metadata });
    throw new Error(`Unexpected request: ${init?.method} ${path}`);
  });
}

function clientWithSecrets(secrets: DecryptedVaultSecret[], onResponse?: (metadata: ResponseMetadata) => void) {
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", onResponse });
  client.vault._unlocked = new UnlockedVault(client.vault.http, orgKey, secrets);
  return client;
}

async function credentials(client: Inkbox) {
  return (await (await client.getIdentity("example-agent")).getCredentials()).list();
}

it.each(["scoped", "parent"])("shares %s deletes with existing views and fresh identity credentials", async (origin) => {
  const first = secret("first");
  const second = secret("second");
  const client = clientWithSecrets([first, second]);
  const parent = client.vault.unlocked!;
  const request = mockVaultFetch();

  const result = await client.withResponseMetadata(async (scope) => {
    const scoped = scope.vault.unlocked!;
    expect(scoped).not.toBe(parent);
    expect(scope.vault.unlocked).toBe(scoped);
    await (origin === "scoped" ? scoped : parent).deleteSecret(first.id);
    expect(parent.secrets).toEqual([second]);
    expect(scoped.secrets).toEqual([second]);
    expect(await credentials(client)).toEqual([second]);
    expect(await credentials(scope)).toEqual([second]);
  });

  expect(result.data).toBeNull();
  expect(result.notices?.map((notice) => notice.code)).toEqual([
    ...(origin === "scoped" ? ["DELETE:/api/v1/vault/secrets/first"] : []),
    "GET:/api/v1/identities/example-agent",
  ]);
  expect(request).toHaveBeenCalledTimes(3);
  expect(client.vault.unlocked).toBe(parent);
});

it.each(["scoped", "parent"])("shares %s updates and creates after a cache replacement", async (origin) => {
  const first = secret("first");
  const updated = { ...first, name: "Updated", payload: { username: "example", password: "changed-password" } };
  const created = secret("created");
  const client = clientWithSecrets([first, secret("deleted")]);
  const parent = client.vault.unlocked!;
  const request = mockVaultFetch();

  await client.withResponseMetadata(async (scope) => {
    const scoped = scope.vault.unlocked!;
    const actor = origin === "scoped" ? scoped : parent;
    await actor.deleteSecret("deleted");
    request
      .mockResolvedValueOnce(Response.json(wire(first)))
      .mockResolvedValueOnce(Response.json(wire(updated)))
      .mockResolvedValueOnce(Response.json(wire(updated)));
    expect((await actor.updateSecret(first.id, { name: updated.name, payload: updated.payload })).name).toBe("Updated");
    expect(parent.secrets).toEqual([updated]);
    expect(scoped.secrets).toEqual([updated]);

    request
      .mockResolvedValueOnce(Response.json(wire(created)))
      .mockResolvedValueOnce(Response.json(wire(created)));
    expect((await actor.createSecret({ name: created.name, payload: created.payload })).id).toBe(created.id);
    expect(parent.secrets).toEqual([updated, created]);
    expect(scoped.secrets).toEqual([updated, created]);
    expect(await credentials(client)).toEqual([updated, created]);
    expect(await credentials(scope)).toEqual([updated, created]);
  });
});

it("keeps failed deletes unchanged and preserves ordinary errors and response callbacks", async () => {
  const first = secret("first");
  const observed = vi.fn(() => { throw new Error("Observer failed"); });
  const client = clientWithSecrets([first], observed);
  const request = mockVaultFetch().mockResolvedValueOnce(Response.json(
    { detail: "No access", agent_support: "Contact support." }, { status: 403, headers: headers("denied") },
  ));
  const result = await client.withResponseMetadata(async (scope) => {
    await expect(scope.vault.unlocked!.deleteSecret(first.id)).rejects.toMatchObject({
      statusCode: 403, agentSupport: "Contact support.",
    });
    expect(scope.vault.unlocked!.secrets).toEqual([first]);
  });
  expect(result.notices?.map((notice) => notice.code)).toEqual(["denied"]);
  expect(client.vault.unlocked!.secrets).toEqual([first]);
  expect(observed).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});

it("shares state across concurrent and nested scopes without mixing notices", async () => {
  const observed = vi.fn();
  const client = clientWithSecrets(["outer", "inner", "parallel", "parent"].map(secret), observed);
  mockVaultFetch();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const outer = client.withResponseMetadata(async (scope) => {
    const view = scope.vault.unlocked!;
    await gate;
    await view.deleteSecret("outer");
    const nested = await scope.withResponseMetadata(async (inner) => {
      await inner.vault.unlocked!.deleteSecret("inner");
      expect(inner.vault.unlocked!.secrets).toEqual([]);
    });
    expect(nested.notices?.map((notice) => notice.code)).toEqual(["DELETE:/api/v1/vault/secrets/inner"]);
    expect(view.secrets).toEqual([]);
  });
  const [parallel] = await Promise.all([
    client.withResponseMetadata((scope) => scope.vault.unlocked!.deleteSecret("parallel")),
    client.vault.unlocked!.deleteSecret("parent"),
  ]);
  release();
  expect((await outer).notices?.map((notice) => notice.code)).toEqual(["DELETE:/api/v1/vault/secrets/outer"]);
  expect(parallel.notices?.map((notice) => notice.code)).toEqual(["DELETE:/api/v1/vault/secrets/parallel"]);
  expect(client.vault.unlocked!.secrets).toEqual([]);
  expect(observed).toHaveBeenCalledTimes(4);
});

it("shares scoped unlocks and re-unlocks with parent and sibling clients, rebinding each transport", async () => {
  const stored = [secret("first")];
  const request = mockVaultFetch(stored);
  const observed = vi.fn();
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", onResponse: observed });
  const sibling = (await client.withResponseMetadata((scope) => scope)).data;
  expect(sibling.vault.unlocked).toBeNull();
  expect(request).not.toHaveBeenCalled();

  const outer = await client.withResponseMetadata(async (scope) => {
    const unlocked = await scope.vault.unlock(vaultKey);
    expect(scope.vault.unlocked).toBe(unlocked);
    expect(client.vault.unlocked!.secrets).toEqual(stored);
    expect(sibling.vault.unlocked!.secrets).toEqual(stored);
    const identity = await client.getIdentity("example-agent");
    expect((await identity.getCredentials()).list()).toEqual(stored);

    stored.splice(0, 1, secret("second"));
    const inner = await scope.withResponseMetadata(async (nested) => {
      await nested.vault.unlock(vaultKey);
      expect(scope.vault.unlocked).not.toBe(unlocked);
      expect((await identity.getCredentials()).list()).toEqual(stored);
      expect(sibling.vault.unlocked!.secrets).toEqual(stored);
      await client.vault.unlocked!.deleteSecret("parent-only");
      await scope.vault.unlocked!.deleteSecret("outer-only");
      await nested.vault.unlocked!.deleteSecret("second");
    });
    expect(inner.notices?.map((notice) => notice.code)).toEqual([
      "GET:/api/v1/vault/info", "GET:/api/v1/vault/unlock", "GET:/api/v1/vault/keys", "DELETE:/api/v1/vault/secrets/second",
    ]);
    expect(client.vault.unlocked!.secrets).toEqual([]);
    expect(scope.vault.unlocked!.secrets).toEqual([]);
    expect(sibling.vault.unlocked!.secrets).toEqual([]);
  });
  expect(outer.notices?.map((notice) => notice.code)).toEqual([
    "GET:/api/v1/vault/info", "GET:/api/v1/vault/unlock", "GET:/api/v1/vault/keys", "DELETE:/api/v1/vault/secrets/outer-only",
  ]);
  expect(observed).toHaveBeenCalledTimes(10);
});

it("sees a pending constructor unlock through existing scopes without collecting its notices", async () => {
  const stored = [secret("first")];
  const request = mockVaultFetch(stored);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const respond = request.getMockImplementation()!;
  request.mockImplementationOnce(async (...args) => { await gate; return respond(...args); });
  const observed = vi.fn();
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", vaultKey, onResponse: observed });

  const result = client.withResponseMetadata(async (scope) => {
    expect(scope.vault.unlocked).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    release();
    expect(await scope.ready()).toBe(scope);
    expect(scope.vault.unlocked!.secrets).toEqual(stored);
    expect(await credentials(scope)).toEqual(stored);
    await scope.vault.unlocked!.deleteSecret("first");
  });
  expect((await result).notices?.map((notice) => notice.code)).toEqual([
    "GET:/api/v1/identities/example-agent", "DELETE:/api/v1/vault/secrets/first",
  ]);
  expect(client.vault.unlocked!.secrets).toEqual([]);
  expect(await credentials(client)).toEqual([]);
  expect(observed).toHaveBeenCalledTimes(6);
});

it("refreshes an existing scoped identity after a parent re-unlock", async () => {
  const stored = [secret("first")];
  mockVaultFetch(stored);
  const client = clientWithSecrets(stored);
  const result = await client.withResponseMetadata(async (scope) => {
    const view = scope.vault.unlocked;
    const identity = await scope.getIdentity("example-agent");
    const before = await identity.getCredentials();
    stored.splice(0, 1, secret("second"));
    await client.vault.unlock(vaultKey);
    expect(scope.vault.unlocked).not.toBe(view);
    expect(scope.vault.unlocked!.secrets).toEqual(stored);
    const after = await identity.getCredentials();
    expect(after).not.toBe(before);
    expect(after.list()).toEqual(stored);
    await scope.vault.unlocked!.deleteSecret("second");
  });
  expect(result.notices?.map((notice) => notice.code)).toEqual([
    "GET:/api/v1/identities/example-agent", "DELETE:/api/v1/vault/secrets/second",
  ]);
  expect(client.vault.unlocked!.secrets).toEqual([]);
});

it("propagates a constructor unlock failure through ready and credentials in every scope", async () => {
  mockVaultFetch().mockResolvedValueOnce(Response.json({ detail: "No access" }, { status: 403, headers: headers("denied") }));
  const observed = vi.fn();
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com", vaultKey, onResponse: observed });
  const result = await client.withResponseMetadata(async (scope) => {
    await expect(scope.ready()).rejects.toBeInstanceOf(InkboxAPIError);
    const identity = await scope.getIdentity("example-agent");
    await expect(identity.getCredentials()).rejects.toBeInstanceOf(InkboxAPIError);
    expect(scope.vault.unlocked).toBeNull();
  });
  await expect(client.ready()).rejects.toBeInstanceOf(InkboxAPIError);
  expect(client.vault.unlocked).toBeNull();
  expect(result.notices?.map((notice) => notice.code)).toEqual(["GET:/api/v1/identities/example-agent"]);
  expect(observed).toHaveBeenCalledTimes(2);
});
