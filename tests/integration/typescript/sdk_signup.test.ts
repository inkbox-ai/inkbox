// tests/integration/typescript/sdk_signup.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Inkbox } from "@inkbox/sdk";
import { randomUUID } from "node:crypto";
import {
  loadConfig,
  bootstrapTestOrg,
  cleanupTestOrg,
  logStep,
  type SdkIntegrationConfig,
  type BootstrapResult,
} from "./helpers.js";

describe("TypeScript SDK signup", { timeout: 300_000 }, () => {
  let config: SdkIntegrationConfig;
  let bootstrap: BootstrapResult;

  beforeAll(async () => {
    config = loadConfig();
    bootstrap = await bootstrapTestOrg(config);
  });

  afterAll(async () => {
    if (bootstrap) {
      await cleanupTestOrg(config, bootstrap);
    }
  });

  it("accepts a custom handle and email local part", async () => {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const agentHandle = `sdk-signup-${suffix}`;
    const emailLocalPart = `sdk.signup.${suffix}`;

    logStep(config, "sign up agent with explicit handle and email local part");
    const signup = await Inkbox.signup(
      {
        humanEmail: bootstrap.emailAddress,
        noteToHuman: "TypeScript SDK integration signup test",
        agentHandle,
        emailLocalPart,
      },
      { baseUrl: config.baseUrl, timeoutMs: config.httpTimeout },
    );
    expect(signup.agentHandle).toBe(agentHandle);
    expect(signup.emailAddress.startsWith(`${emailLocalPart}@`)).toBe(true);

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

    logStep(config, "find pending signup and approve it into bootstrap org");
    const pendingResp = await fetch(`${apiUrl}/agent-signup/pending`, {
      headers: { Authorization: `Bearer ${jwt}` },
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
        Authorization: `Bearer ${jwt}`,
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
    inkbox.close();
  });
});
