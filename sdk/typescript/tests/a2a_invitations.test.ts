import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Inkbox } from "../src/inkbox.js";
import { A2AInvitationParseError, extractA2AInvitationToken } from "../src/a2a/invitations.js";

const TOKEN = "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const RAW = {
  id: "inv_1",
  issuer_organization_id: "org_1",
  inviter_email: "owner@example.com",
  peer_agent_handles: ["support"],
  recipient_email: null,
  status: "pending",
  email_status: "not_requested",
  email_sent_at: null,
  invitee_identity_id: null,
  invitee_agent_handle: null,
  invitee_organization_id: null,
  expires_at: "2026-08-11T00:00:00Z",
  accepted_at: null,
  declined_at: null,
  revoked_at: null,
  created_at: "2026-08-04T00:00:00Z",
  updated_at: "2026-08-04T00:00:00Z",
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.restoreAllMocks());

function respond(body: unknown): void {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  } as Response);
}

describe("A2AInvitationsResource", () => {
  it("previews an invitation without constructing a client or sending a key", async () => {
    respond({
      inviter_email: "owner@example.test",
      peer_agent_handles: ["support", "billing"],
      expires_at: "2026-08-11T00:00:00Z",
      agent_handoff_prompt: "Review and accept this invitation.",
    });

    const result = await Inkbox.previewA2AInvitation(
      `https://inkbox.ai/console/a2a/invitations/accept#token=${TOKEN}`,
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://inkbox.ai/api/v1/a2a/invitations/preview");
    expect((init!.headers as Record<string, string>)["X-API-Key"]).toBeUndefined();
    expect(JSON.parse(init!.body as string)).toEqual({ invitation_token: TOKEN });
    expect(result).toEqual({
      inviterEmail: "owner@example.test",
      peerAgentHandles: ["support", "billing"],
      expiresAt: "2026-08-11T00:00:00Z",
      agentHandoffPrompt: "Review and accept this invitation.",
    });
  });

  it("creates an invitation and preserves its one-time secret", async () => {
    respond({
      ...RAW,
      invitation_token: TOKEN,
      invitation_url: `https://inkbox.ai/console/a2a/invitations/accept#token=${TOKEN}`,
      agent_handoff_prompt: "handoff",
    });
    const client = new Inkbox({ apiKey: "ApiKey_admin" });
    const result = await client.a2aInvitations.create({
      peerAgentHandles: ["support"], expiresInSeconds: 7200,
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      peer_agent_handles: ["support"], expires_in_seconds: 7200,
    });
    expect(result.invitationToken).toBe(TOKEN);
    expect(result.invitationUrl).toContain("/console/a2a/invitations/accept#token=");
    expect(result.inviterEmail).toBe("owner@example.com");
  });

  it("uses canonical list, get, revoke, and accept routes", async () => {
    const client = new Inkbox({ apiKey: "ApiKey_test" });
    respond({ items: [RAW], next_cursor: "next" });
    await client.a2aInvitations.list({ status: "pending", limit: 10 });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/api/v1/a2a/invitations?");

    respond(RAW);
    await client.a2aInvitations.get("inv_1");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://inkbox.ai/api/v1/a2a/invitations/inv_1");

    respond({ ...RAW, status: "revoked" });
    await client.a2aInvitations.revoke("inv_1");
    expect(vi.mocked(fetch).mock.calls[2][0]).toBe("https://inkbox.ai/api/v1/a2a/invitations/inv_1/revoke");

    respond({ invitation_id: "inv_1", status: "accepted", invitee_identity_id: "identity_2", invitee_agent_handle: "buyer", peer_agent_handles: ["support"], accepted_at: "2026-08-04T01:00:00Z" });
    const result = await client.a2aInvitations.accept(TOKEN);
    expect(result.inviteeAgentHandle).toBe("buyer");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string)).toEqual({ invitation_token: TOKEN });
  });

  it("extracts a share URL before sending accept", async () => {
    const client = new Inkbox({ apiKey: "ApiKey_test", baseUrl: "https://tenant.example.test" });
    respond({ invitation_id: "inv_1", status: "accepted", invitee_identity_id: "identity_2", invitee_agent_handle: "buyer", peer_agent_handles: ["support"], accepted_at: "2026-08-04T01:00:00Z" });
    await client.a2aInvitations.accept(`https://tenant.example.test/console/a2a/invitations/accept#token=${TOKEN}`);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ invitation_token: TOKEN });
  });

  it("does not invent a share URL for an old server", async () => {
    const { inviter_email: _inviterEmail, ...oldServerInvitation } = RAW;
    respond({ ...oldServerInvitation, invitation_token: TOKEN });
    const client = new Inkbox({ apiKey: "ApiKey_admin" });
    const result = await client.a2aInvitations.create({ peerAgentHandles: ["support"] });
    expect(result.invitationUrl).toBeUndefined();
    expect(result.inviterEmail).toBeNull();
  });
});

describe("extractA2AInvitationToken", () => {
  const vectors = JSON.parse(readFileSync(
    new URL("../../../tests/fixtures/a2a_invitation_inputs.json", import.meta.url),
    "utf8",
  )) as {
    valid: Array<{ base_url: string; input: string; token: string }>;
    invalid: Array<{ base_url: string; input: string }>;
  };

  it("passes the shared valid vectors", () => {
    for (const item of vectors.valid) {
      expect(extractA2AInvitationToken(item.input, item.base_url)).toBe(item.token);
    }
  });

  it("rejects the shared adversarial vectors without reflecting secrets", () => {
    for (const item of vectors.invalid) {
      try {
        extractA2AInvitationToken(item.input, item.base_url);
        throw new Error("expected parser failure");
      } catch (error) {
        expect(error).toBeInstanceOf(A2AInvitationParseError);
        expect(String(error)).not.toContain(TOKEN);
      }
    }
  });

  it("rejects oversized input", () => {
    expect(() => extractA2AInvitationToken("x".repeat(2049))).toThrow(
      A2AInvitationParseError,
    );
  });
});
