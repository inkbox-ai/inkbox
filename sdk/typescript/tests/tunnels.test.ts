// sdk/typescript/tests/tunnels.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { TunnelsResource } from "../src/tunnels/resources/tunnels.js";
import {
  TunnelCSRStateConflict,
  TunnelNameInvalid,
  TunnelTLSModeMismatch,
} from "../src/tunnels/exceptions.js";
import { TunnelStatus } from "../src/tunnels/types.js";
import { validateTunnelName } from "../src/tunnels/_validation.js";
import {
  ForwardTargetRefused,
  validateEnvelopePath,
  validateForwardTarget,
} from "../src/tunnels/client/_validation.js";

const BASE = "https://inkbox.ai/api/v1";
const API_KEY = "test-key";

function serverTunnel(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: "org_test",
    tunnel_name: "my-agent",
    tls_mode: "edge",
    cert_pem: null,
    cert_fingerprint_sha256: null,
    cert_expires_at: null,
    status: "active",
    last_connected_at: null,
    last_connected_ip_addr: null,
    currently_connected: false,
    public_host: "my-agent.inkboxwire.com",
    zone: "inkboxwire.com",
    metadata: { team: "platform" },
    created_at: "2025-01-01T00:00:00+00:00",
    updated_at: "2025-01-01T00:00:00+00:00",
    ...overrides,
  };
}

function makeHeaders() {
  return {
    get() { return null; },
    getSetCookie() { return []; },
  } as unknown as Headers;
}

function makeResponse(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    statusText: "Error",
    headers: makeHeaders(),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("TunnelsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function tunnels() {
    const http = new HttpTransport(API_KEY, BASE);
    return new TunnelsResource(http);
  }

  // --- Local validation (against the standalone validator now) ---

  it("rejects invalid tunnel_name locally", () => {
    expect(() => validateTunnelName("--bad")).toThrow(TunnelNameInvalid);
  });

  it("rejects names that are too short", () => {
    expect(() => validateTunnelName("ab")).toThrow(TunnelNameInvalid);
  });

  it("rejects names with consecutive hyphens", () => {
    expect(() => validateTunnelName("my--agent")).toThrow(TunnelNameInvalid);
  });

  it("normalizes @prefix and uppercase", () => {
    expect(validateTunnelName("@MyAgent")).toBe("myagent");
  });

  // --- Status parsing ---

  it("recognises the three lifecycle states", async () => {
    const t = tunnels();
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(200, serverTunnel({ status: "deleted" })),
    );
    expect((await t.get("abc")).status).toBe(TunnelStatus.DELETED);
  });

  it("preserves unknown statuses as raw strings (no fail-open)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(200, serverTunnel({ status: "quarantined" })),
    );
    const t = tunnels();
    const out = await t.get("abc");
    expect(out.status).toBe("quarantined");
    expect(out.status).not.toBe(TunnelStatus.ACTIVE);
  });

  it("treats null metadata as {}", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(200, serverTunnel({ metadata: null })),
    );
    const t = tunnels();
    const out = await t.get("abc");
    expect(out.metadata).toEqual({});
  });

  it("parses a durable-config-only payload without fabricating omitted fields", async () => {
    // Identity-embedded tunnels may be slimmed to durable config; omitted
    // fields must surface as null/{} and unknown keys must be ignored.
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(200, {
        id: "11111111-1111-1111-1111-111111111111",
        tunnel_name: "my-agent",
        agent_identity_id: "22222222-2222-2222-2222-222222222222",
        tls_mode: "edge",
        status: "active",
        public_host: "my-agent.inkboxwire.com",
        zone: "inkboxwire.com",
        created_at: "2025-01-01T00:00:00+00:00",
        updated_at: "2025-01-01T00:00:00+00:00",
      }),
    );
    const t = tunnels();
    const out = await t.get("abc");
    expect(out.organizationId).toBeNull();
    expect(out.currentlyConnected).toBeNull();
    expect(out.certPem).toBeNull();
    expect(out.lastConnectedAt).toBeNull();
    expect(out.metadata).toEqual({});
    expect(out.publicHost).toBe("my-agent.inkboxwire.com");
  });

  // --- list() unwraps {tunnels: [...]} envelope ---

  it("list() unwraps the tunnels envelope", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(200, { tunnels: [serverTunnel()] }),
    );
    const t = tunnels();
    const out = await t.list();
    expect(out).toHaveLength(1);
    expect(out[0].tunnelName).toBe("my-agent");
  });

  // --- update() semantics ---

  it("update with no fields sends an empty body", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(200, serverTunnel()));
    const t = tunnels();
    await t.update("abc", {});
    const args = vi.mocked(fetch).mock.calls[0];
    const init = args[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("update with metadata={} clears metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(200, serverTunnel()));
    const t = tunnels();
    await t.update("abc", { metadata: {} });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ metadata: {} });
  });

  it("update with metadata: null sends null; the server collapses to {}", async () => {
    vi.mocked(fetch).mockResolvedValue(makeResponse(200, serverTunnel()));
    const t = tunnels();
    await t.update("abc", { metadata: null });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ metadata: null });
  });

  // --- Error mapping ---

  it("sign_csr 409 with edge mention -> TunnelTLSModeMismatch", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(409, {
        detail: "tunnel is in edge tls_mode; CSR signing is passthrough-only",
      }),
    );
    const t = tunnels();
    await expect(
      t.signCsr("abc", { csrPem: "pem" }),
    ).rejects.toBeInstanceOf(TunnelTLSModeMismatch);
  });

  it("sign_csr 409 state conflict -> TunnelCSRStateConflict", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeResponse(409, { detail: "tunnel is in delete_pending state" }),
    );
    const t = tunnels();
    await expect(
      t.signCsr("abc", { csrPem: "pem" }),
    ).rejects.toBeInstanceOf(TunnelCSRStateConflict);
  });

});

// --- Validation helpers (unit) ---

describe("validateForwardTarget", () => {
  it.each([
    ["http://localhost:8080"],
    ["http://127.0.0.1:8080"],
    ["http://127.0.0.5:9000"],
    ["http://[::1]:8080"],
  ])("accepts loopback %s", (url) => {
    expect(() => validateForwardTarget(url)).not.toThrow();
  });

  it.each([
    ["http://example.com"],
    ["http://10.0.0.5"],
    ["http://192.168.1.1"],
    ["http://internal.example.com"],
  ])("refuses non-loopback %s", (url) => {
    expect(() => validateForwardTarget(url)).toThrow(ForwardTargetRefused);
  });

  it("allowRemoteForwarding bypasses the check", () => {
    expect(() =>
      validateForwardTarget("http://example.com", { allowRemoteForwarding: true }),
    ).not.toThrow();
  });
});

describe("validateEnvelopePath", () => {
  it.each([
    "/foo/../bar",
    "/foo/./bar",
    "/foo/%2e%2e/bar",
    "/foo/%2E%2E/bar",
    "/foo/%252e%252e/bar",
    "/foo/%2f/bar",
    "/foo/%5cbar",
    // Raw backslash: IIS / Tomcat / some static-file libs treat it as
    // a separator. Block it so `/static\..\secret` can't slip past.
    "/foo\\..\\bar",
    "/static\\secret",
    "/\\evil",
  ])("rejects %s", (path) => {
    expect(validateEnvelopePath(path)).toBe("invalid-path");
  });

  it.each([
    "/webhook",
    "/api/v1/users",
    "/path/with%20space",
    "/with-query?x=1&y=2",
  ])("accepts %s", (path) => {
    expect(validateEnvelopePath(path)).toBeNull();
  });
});
