// tests/integration/typescript/sdk_lifecycle.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Inkbox } from "@inkbox/sdk";
import type { Message, DecryptedVaultSecret } from "@inkbox/sdk";
import {
  loadConfig,
  bootstrapTestOrg,
  cleanupTestOrg,
  logStep,
  pollUntil,
  type SdkIntegrationConfig,
  type BootstrapResult,
} from "./helpers.js";

describe("TypeScript SDK lifecycle", { timeout: 300_000 }, () => {
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

  it("exercises the full SDK lifecycle", async () => {
    const inkbox = new Inkbox({
      apiKey: bootstrap.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.httpTimeout,
    });

    // ── whoami ──────────────────────────────────────────────────
    logStep(config, "whoami");
    const whoami = await inkbox.whoami();
    expect(whoami.organizationId).toBe(bootstrap.orgId);

    // ── empty state ────────────────────────────────────────────
    logStep(config, "verify empty identity list");
    const empty = await inkbox.listIdentities();
    expect(empty).toHaveLength(0);

    // ── create identities ─────────────────────────────────────
    logStep(config, "create identity alpha with mailbox");
    const alpha = await inkbox.createIdentity("alpha", { createMailbox: true });
    expect(alpha.agentHandle).toBe("alpha");
    expect(alpha.mailbox).not.toBeNull();
    expect(alpha.emailAddress).toBeTruthy();

    logStep(config, "create identity bravo with mailbox");
    const bravo = await inkbox.createIdentity("bravo", { createMailbox: true });
    expect(bravo.agentHandle).toBe("bravo");
    expect(bravo.mailbox).not.toBeNull();

    logStep(config, "list identities shows 2");
    const identities = await inkbox.listIdentities();
    expect(identities).toHaveLength(2);

    // ── get identity ──────────────────────────────────────────
    logStep(config, "get identity alpha");
    const alphaFetched = await inkbox.getIdentity("alpha");
    expect(alphaFetched.id).toBe(alpha.id);
    expect(alphaFetched.emailAddress).toBe(alpha.emailAddress);

    // ── send email alpha → bravo ──────────────────────────────
    const subject = `sdk-integration-ts-${config.environment}`;
    logStep(config, `send email from alpha to bravo: ${subject}`);
    const sent = await alpha.sendEmail({
      to: [bravo.emailAddress!],
      subject,
      bodyText: "Hello from the TypeScript SDK integration test!",
    });
    expect(sent.subject).toBe(subject);
    expect(sent.direction).toBe("outbound");

    // ── poll for delivery ─────────────────────────────────────
    logStep(config, "poll for inbound delivery to bravo");
    const messages = await pollUntil<Message[]>(
      "inbound message delivered to bravo",
      async () => {
        const msgs: Message[] = [];
        for await (const msg of bravo.iterEmails({ direction: "inbound" })) {
          msgs.push(msg);
          if (msgs.length >= 50) break;
        }
        return msgs;
      },
      {
        timeoutMs: config.pollTimeout,
        intervalMs: config.pollInterval,
        isReady: (msgs) => msgs.some((m) => m.subject === subject),
        verbose: config.verbose,
      },
    );
    const inboundMsg = messages.find((m) => m.subject === subject)!;
    expect(inboundMsg.direction).toBe("inbound");

    // ── message detail ────────────────────────────────────────
    logStep(config, "get message detail");
    const detail = await bravo.getMessage(inboundMsg.id);
    expect(detail.bodyText).toBeTruthy();
    expect(detail.bodyText).toContain("TypeScript SDK");
    expect(detail.threadId).toBeTruthy();

    // ── mark read ─────────────────────────────────────────────
    logStep(config, "mark message as read");
    await bravo.markEmailsRead([inboundMsg.id]);

    // ── thread ────────────────────────────────────────────────
    logStep(config, "get thread");
    const thread = await bravo.getThread(detail.threadId!);
    expect(thread.subject).toBe(subject);
    expect(thread.messages.length).toBeGreaterThanOrEqual(1);

    // ── vault + credentials ───────────────────────────────────
    const vaultKey = "IntegrationTest-Key-01!";
    logStep(config, "initialize vault");
    const vaultResult = await inkbox.vault.initialize(vaultKey);
    expect(vaultResult.vaultKeyId).toBeTruthy();
    expect(vaultResult.recoveryCodes).toHaveLength(4);

    logStep(config, "vault info");
    const vaultInfo = await inkbox.vault.info();
    expect(vaultInfo).not.toBeNull();
    expect(vaultInfo!.keyCount).toBe(1);
    expect(vaultInfo!.recoveryKeyCount).toBe(4);
    expect(vaultInfo!.secretCount).toBe(0);

    logStep(config, "unlock vault");
    await inkbox.vault.unlock(vaultKey);

    logStep(config, "create API key secret via alpha identity");
    const secretA = await alpha.createSecret({
      name: "test-api-key",
      payload: { apiKey: "sk-test-secret-12345" },
      description: "Integration test API key",
    });
    expect(secretA.name).toBe("test-api-key");
    expect(secretA.secretType).toBe("api_key");

    logStep(config, "create login secret via alpha identity");
    const secretB = await alpha.createSecret({
      name: "test-login",
      payload: { username: "testuser", password: "testpass123" },
      description: "Integration test login",
    });
    expect(secretB.name).toBe("test-login");
    expect(secretB.secretType).toBe("login");

    logStep(config, "list secrets shows both");
    const allSecrets = await inkbox.vault.listSecrets();
    expect(allSecrets).toHaveLength(2);

    logStep(config, "list secrets filtered by type");
    const apiKeySecrets = await inkbox.vault.listSecrets({ secretType: "api_key" });
    expect(apiKeySecrets).toHaveLength(1);
    expect(apiKeySecrets[0].name).toBe("test-api-key");

    logStep(config, "verify alpha credentials include both secrets (no client-side filtering)");
    const creds = await alpha.getCredentials();
    const apiKeys = creds.listApiKeys();
    expect(apiKeys).toHaveLength(1);
    expect(apiKeys[0].payload.apiKey).toBe("sk-test-secret-12345");
    const logins = creds.listLogins();
    expect(logins).toHaveLength(1);
    expect(logins[0].payload.username).toBe("testuser");

    logStep(config, "get secret by ID and verify decrypted payload");
    const fetched = await alpha.getSecret(secretA.id);
    expect(fetched.name).toBe("test-api-key");
    expect(fetched.payload.apiKey).toBe("sk-test-secret-12345");

    logStep(config, "delete secrets");
    await alpha.deleteSecret(secretA.id);
    await alpha.deleteSecret(secretB.id);
    const remaining = await inkbox.vault.listSecrets();
    expect(remaining).toHaveLength(0);

    // ── signing key ───────────────────────────────────────────
    logStep(config, "create signing key");
    const signingKey = await inkbox.createSigningKey();
    expect(signingKey.signingKey).toBeTruthy();
    expect(signingKey.createdAt).toBeTruthy();

    // ── cleanup: delete identities ────────────────────────────
    logStep(config, "delete identities");
    await alpha.delete();
    await bravo.delete();

    logStep(config, "verify empty after cleanup");
    const final = await inkbox.listIdentities();
    expect(final).toHaveLength(0);
  });
});
