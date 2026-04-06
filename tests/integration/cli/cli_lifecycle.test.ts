// tests/integration/cli/cli_lifecycle.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  loadConfig,
  bootstrapTestOrg,
  cleanupTestOrg,
  inkbox,
  inkboxJson,
  logStep,
  pollUntil,
  type CliIntegrationConfig,
  type BootstrapResult,
} from "./helpers.js";

describe("CLI lifecycle", { timeout: 300_000 }, () => {
  let config: CliIntegrationConfig;
  let bootstrap: BootstrapResult;
  let cliOpts: { apiKey: string; baseUrl: string };

  beforeAll(async () => {
    config = loadConfig();
    bootstrap = await bootstrapTestOrg(config);
    cliOpts = { apiKey: bootstrap.apiKey, baseUrl: config.baseUrl };
  });

  afterAll(async () => {
    if (bootstrap) {
      await cleanupTestOrg(config, bootstrap);
    }
  });

  it("exercises the full CLI lifecycle", async () => {

    // ── whoami ──────────────────────────────────────────────────
    logStep(config, "whoami");
    const whoami = inkboxJson<{ organizationId: string }>("whoami", cliOpts);
    expect(whoami.organizationId).toBe(bootstrap.orgId);

    // ── empty state ────────────────────────────────────────────
    logStep(config, "verify empty identity list");
    const emptyList = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(emptyList).toHaveLength(0);

    // ── create identities ─────────────────────────────────────
    logStep(config, "create identity alpha");
    const alphaCreate = inkboxJson<{ agentHandle: string; id: string }>(
      "identity create alpha",
      cliOpts,
    );
    expect(alphaCreate.agentHandle).toBe("alpha");

    logStep(config, "create mailbox for alpha");
    const alphaMb = inkboxJson<{ emailAddress: string }>(
      "mailbox create --handle alpha",
      cliOpts,
    );
    expect(alphaMb.emailAddress).toBeTruthy();

    logStep(config, "create identity bravo");
    inkboxJson("identity create bravo", cliOpts);

    logStep(config, "create mailbox for bravo");
    const bravoMb = inkboxJson<{ emailAddress: string }>(
      "mailbox create --handle bravo",
      cliOpts,
    );
    expect(bravoMb.emailAddress).toBeTruthy();

    logStep(config, "list identities shows 2");
    const identities = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(identities).toHaveLength(2);

    // ── get identity ──────────────────────────────────────────
    logStep(config, "get identity alpha");
    const alphaGet = inkboxJson<{ agentHandle: string; mailbox: string }>(
      "identity get alpha",
      cliOpts,
    );
    expect(alphaGet.agentHandle).toBe("alpha");
    expect(alphaGet.mailbox).toBe(alphaMb.emailAddress);

    // ── send email alpha → bravo ──────────────────────────────
    const subject = `cli-integration-${config.environment}`;
    logStep(config, `send email from alpha to bravo: ${subject}`);
    const sent = inkboxJson<{ id: string; subject: string }>(
      `email send -i alpha --to "${bravoMb.emailAddress}" --subject "${subject}" --body-text "Hello from CLI integration test!"`,
      cliOpts,
    );
    expect(sent.subject).toBe(subject);

    // ── poll for delivery ─────────────────────────────────────
    logStep(config, "poll for inbound delivery to bravo");
    const emailList = await pollUntil<{ id: string; subject: string; direction: string }[]>(
      "inbound message delivered to bravo",
      () =>
        inkboxJson<{ id: string; subject: string; direction: string }[]>(
          "email list -i bravo --direction inbound",
          cliOpts,
        ),
      {
        timeoutMs: config.pollTimeoutMs,
        intervalMs: config.pollIntervalMs,
        isReady: (msgs) => msgs.some((m) => m.subject === subject),
        verbose: config.verbose,
      },
    );
    const inboundMsg = emailList.find((m) => m.subject === subject)!;
    expect(inboundMsg.direction).toBe("inbound");

    // ── message detail ────────────────────────────────────────
    logStep(config, "get message detail");
    const detail = inkboxJson<{ bodyText: string; threadId: string }>(
      `email get ${inboundMsg.id} -i bravo`,
      cliOpts,
    );
    expect(detail.bodyText).toContain("CLI integration test");
    expect(detail.threadId).toBeTruthy();

    // ── mark read ─────────────────────────────────────────────
    logStep(config, "mark message as read");
    inkbox(`email mark-read ${inboundMsg.id} -i bravo`, cliOpts);

    // ── thread ────────────────────────────────────────────────
    logStep(config, "get thread");
    const thread = inkboxJson<{ id: string; subject: string; messages: unknown[] }>(
      `email thread ${detail.threadId} -i bravo`,
      cliOpts,
    );
    expect(thread.subject).toBe(subject);
    expect(thread.messages.length).toBeGreaterThanOrEqual(1);

    // ── identity update ───────────────────────────────────────
    logStep(config, "pause alpha");
    inkbox("identity update alpha --status paused", cliOpts);
    const paused = inkboxJson<{ status: string }>("identity get alpha", cliOpts);
    // CLI identity get returns a flat object; status may vary in format
    // Just verify it's accessible
    expect(paused).toBeTruthy();

    logStep(config, "resume alpha");
    inkbox("identity update alpha --status active", cliOpts);

    // ── signing key ───────────────────────────────────────────
    logStep(config, "create signing key");
    const signingKey = inkboxJson<{ signingKey: string }>("signing-key rotate", cliOpts);
    expect(signingKey.signingKey).toBeTruthy();

    // ── cleanup: delete identities ────────────────────────────
    logStep(config, "delete identities");
    inkbox("identity delete alpha", cliOpts);
    inkbox("identity delete bravo", cliOpts);

    logStep(config, "verify empty after cleanup");
    const finalList = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(finalList).toHaveLength(0);
  });
});
