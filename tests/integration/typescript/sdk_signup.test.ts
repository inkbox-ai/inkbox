// tests/integration/typescript/sdk_signup.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { Inkbox } from "@inkbox/sdk";
import { randomUUID } from "node:crypto";
import {
  loadConfig,
  loadBootstrapFromEnv,
  logStep,
  registerOrgForCleanup,
  type SdkIntegrationConfig,
  type BootstrapResult,
} from "./helpers.js";

// The signup human is shared, so the pending list can also hold an agent that a
// concurrently running suite created moments ago. Only agents older than this
// count as leftovers worth claiming.
const LEFTOVER_MIN_AGE_MS = 10 * 60 * 1000;

// Approve (claim) leftover unclaimed agents linked to the signup human, freeing
// its per-email unclaimed count. Best-effort: a leftover that won't approve is
// skipped, since freeing even one slot is enough to sign up.
async function approveStalePending(
  apiUrl: string,
  authHeaders: Record<string, string>,
  orgId: string,
): Promise<void> {
  const resp = await fetch(`${apiUrl}/agent-signup/pending`, { headers: authHeaders });
  if (!resp.ok) return;
  const { agents } = await resp.json();
  const cutoff = Date.now() - LEFTOVER_MIN_AGE_MS;
  for (const agent of agents ?? []) {
    if (Date.parse(agent.created_at) > cutoff) continue;
    try {
      await fetch(`${apiUrl}/agent-signup/${agent.identity_id}/approve`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: orgId }),
      });
    } catch {
      // best-effort drain
    }
  }
}

describe("TypeScript SDK signup", { timeout: 300_000 }, () => {
  let config: SdkIntegrationConfig;
  let bootstrap: BootstrapResult;

  beforeAll(() => {
    // Bootstrap is provisioned once per vitest run by globalSetup.ts and
    // shared with the lifecycle test (which runs first and cleans up its
    // identities). The signup test then approves a fresh agent into the
    // same org using a random agent_handle, so there's no collision.
    config = loadConfig();
    bootstrap = loadBootstrapFromEnv();
  });

  it("accepts a custom handle and email local part", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const agentHandle = `sdk-signup-${suffix}`;
    // On the platform sending domain, the server forces
    // `email_local_part == agent_handle`. Pass the same value through
    // the SDK call so the wire body still includes `emailLocalPart`
    // explicitly (exercising that arg) without triggering the 422.
    const emailLocalPart = agentHandle;

    const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;

    logStep(config, "mint JWT for human approval");
    const jwtResp = await fetch(`${apiUrl}/testing/create-session-jwt`, {
      method: "POST",
      headers: {
        "X-Interservice-Secret": config.interserviceSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: bootstrap.userId,
        org_id: bootstrap.orgId,
      }),
    });
    expect(jwtResp.ok).toBe(true);
    const jwt = (await jwtResp.json()).jwt as string;
    const authHeaders = { Authorization: `Bearer ${jwt}` };

    // The signup human is shared, so unclaimed agents leaked by earlier failed
    // runs accumulate against a per-email cap and would 429 this signup. Claim
    // those leftovers first to free the cap.
    logStep(config, "drain stale unclaimed agents for the signup human");
    await approveStalePending(apiUrl, authHeaders, bootstrap.orgId);

    logStep(config, "sign up agent with explicit handle and email local part");
    const signup = await Inkbox.signup(
      {
        humanEmail: bootstrap.emailAddress,
        noteToHuman: "TypeScript SDK integration signup test",
        agentHandle,
        emailLocalPart,
        harness: "sdk-integration",
      },
      { baseUrl: config.baseUrl, timeoutMs: config.httpTimeout },
    );
    registerOrgForCleanup(signup.organizationId);
    expect(signup.agentHandle).toBe(agentHandle);
    expect(signup.emailAddress.startsWith(`${emailLocalPart}@`)).toBe(true);

    logStep(config, "find pending signup and approve it into bootstrap org");
    const pendingResp = await fetch(`${apiUrl}/agent-signup/pending`, {
      headers: authHeaders,
    });
    expect(pendingResp.ok).toBe(true);
    const pending = await pendingResp.json();
    const pendingAgent = pending.agents.find(
      (agent: { agent_handle: string }) => agent.agent_handle === agentHandle,
    );
    expect(pendingAgent).toBeTruthy();

    const approveResp = await fetch(`${apiUrl}/agent-signup/${pendingAgent.identity_id}/approve`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ organization_id: bootstrap.orgId }),
    });
    expect(approveResp.ok).toBe(true);

    logStep(config, "verify signed-up agent can load its identity after approval");
    const inkbox = new Inkbox({
      apiKey: signup.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.httpTimeout,
    });
    const identity = await inkbox.getIdentity(agentHandle);
    expect(identity.agentHandle).toBe(agentHandle);
    expect(identity.emailAddress).toBe(signup.emailAddress);
  });
});
