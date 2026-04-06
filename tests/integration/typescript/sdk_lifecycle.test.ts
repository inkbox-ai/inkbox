// tests/integration/typescript/sdk_lifecycle.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Inkbox } from "@inkbox/sdk";
import type { Message } from "@inkbox/sdk";
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

    // ── identity update ───────────────────────────────────────
    logStep(config, "pause and resume alpha");
    await alpha.update({ status: "paused" });
    await alpha.refresh();
    expect(alpha.status).toBe("paused");
    await alpha.update({ status: "active" });
    await alpha.refresh();
    expect(alpha.status).toBe("active");

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
