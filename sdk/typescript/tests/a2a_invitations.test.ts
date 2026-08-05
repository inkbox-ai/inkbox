import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inkbox } from "../src/inkbox.js";

const RAW = {
  id: "inv_1",
  issuer_organization_id: "org_1",
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
  it("creates an invitation and preserves its one-time secret", async () => {
    respond({ ...RAW, invitation_token: "a2ai_secret", agent_handoff_prompt: "handoff" });
    const client = new Inkbox({ apiKey: "ApiKey_admin" });
    const result = await client.a2aInvitations.create({
      peerAgentHandles: ["support"], expiresInSeconds: 7200,
    });
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
      peer_agent_handles: ["support"], expires_in_seconds: 7200,
    });
    expect(result.invitationToken).toBe("a2ai_secret");
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
    const result = await client.a2aInvitations.accept("a2ai_secret");
    expect(result.inviteeAgentHandle).toBe("buyer");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[3][1]!.body as string)).toEqual({ invitation_token: "a2ai_secret" });
  });
});
