// tests/integration/cli/cli_lifecycle.test.ts

import { randomUUID } from "node:crypto";
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

    // Globally unique handles (`agent_handle` is now unique across all
    // orgs and shares its namespace with `tunnel_name`), so parallel CI
    // runs and any prior runs that left stragglers must not collide.
    const runSuffix = randomUUID().slice(0, 8);
    const alphaHandle = `cli-alpha-${runSuffix}`;
    const bravoHandle = `cli-bravo-${runSuffix}`;
    const alphaHostRe = new RegExp(`^${alphaHandle}\\..+\\.inkboxwire\\.com$`);

    // ── whoami ──────────────────────────────────────────────────
    logStep(config, "whoami");
    const whoami = inkboxJson<{ organizationId: string }>("whoami", cliOpts);
    expect(whoami.organizationId).toBe(bootstrap.orgId);

    // ── empty state ────────────────────────────────────────────
    logStep(config, "verify empty identity list");
    const emptyList = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(emptyList).toHaveLength(0);

    // ── create identities (mailbox + tunnel atomic) ───────────
    logStep(config, `create identity ${alphaHandle}`);
    const alphaCreate = inkboxJson<{
      agentHandle: string;
      id: string;
      mailbox: string;
      tunnel: { id: string; publicHost: string; tlsMode: string; status: string };
    }>(
      `identity create ${alphaHandle} --description 'alpha cli-integration'`,
      cliOpts,
    );
    expect(alphaCreate.agentHandle).toBe(alphaHandle);
    expect(alphaCreate.mailbox).toBeTruthy();
    expect(alphaCreate.tunnel).not.toBeNull();
    expect(alphaCreate.tunnel.publicHost).toMatch(alphaHostRe);
    expect(alphaCreate.tunnel.tlsMode).toBe("edge");
    const alphaMb = { emailAddress: alphaCreate.mailbox };

    logStep(config, `create identity ${bravoHandle}`);
    const bravoCreate = inkboxJson<{ mailbox: string; tunnel: { publicHost: string } }>(
      `identity create ${bravoHandle}`,
      cliOpts,
    );
    expect(bravoCreate.mailbox).toBeTruthy();
    const bravoMb = { emailAddress: bravoCreate.mailbox };

    logStep(config, "list identities shows 2");
    const identities = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(identities).toHaveLength(2);

    // ── tunnel get (smoke) ────────────────────────────────────
    logStep(config, `tunnel get ${alphaHandle}`);
    const alphaTunnel = inkboxJson<{ tunnelName: string; tlsMode: string }>(
      `tunnel get ${alphaHandle}`,
      cliOpts,
    );
    expect(alphaTunnel.tunnelName).toBe(alphaHandle);
    expect(alphaTunnel.tlsMode).toBe("edge");

    // ── get identity ──────────────────────────────────────────
    logStep(config, `get identity ${alphaHandle}`);
    const alphaGet = inkboxJson<{
      agentHandle: string;
      mailbox: string;
      description: string | null;
      tunnel: { publicHost: string };
    }>(`identity get ${alphaHandle}`, cliOpts);
    expect(alphaGet.agentHandle).toBe(alphaHandle);
    expect(alphaGet.mailbox).toBe(alphaMb.emailAddress);
    expect(alphaGet.description).toBe("alpha cli-integration");
    expect(alphaGet.tunnel.publicHost).toBe(alphaCreate.tunnel.publicHost);

    // ── send email alpha → bravo ──────────────────────────────
    const subject = `cli-integration-${config.environment}`;
    logStep(config, `send email from ${alphaHandle} to ${bravoHandle}: ${subject}`);
    const sent = inkboxJson<{ id: string; subject: string }>(
      `email send -i ${alphaHandle} --to "${bravoMb.emailAddress}" --subject "${subject}" --body-text "Hello from CLI integration test!"`,
      cliOpts,
    );
    expect(sent.subject).toBe(subject);

    // ── poll for delivery ─────────────────────────────────────
    logStep(config, `poll for inbound delivery to ${bravoHandle}`);
    const emailList = await pollUntil<{ id: string; subject: string; direction: string }[]>(
      `inbound message delivered to ${bravoHandle}`,
      () =>
        inkboxJson<{ id: string; subject: string; direction: string }[]>(
          `email list -i ${bravoHandle} --direction inbound`,
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
      `email get ${inboundMsg.id} -i ${bravoHandle}`,
      cliOpts,
    );
    expect(detail.bodyText).toContain("CLI integration test");
    expect(detail.threadId).toBeTruthy();

    // ── mark read ─────────────────────────────────────────────
    logStep(config, "mark message as read");
    inkbox(`email mark-read ${inboundMsg.id} -i ${bravoHandle}`, cliOpts);

    // ── thread ────────────────────────────────────────────────
    logStep(config, "get thread");
    const thread = inkboxJson<{ id: string; subject: string; messages: unknown[] }>(
      `email thread ${detail.threadId} -i ${bravoHandle}`,
      cliOpts,
    );
    expect(thread.subject).toBe(subject);
    expect(thread.messages.length).toBeGreaterThanOrEqual(1);

    // ── forward bravo → alpha ─────────────────────────────────
    const forwardSubject = `Fwd: ${subject}`;
    logStep(
      config,
      `forward inbound message from ${bravoHandle} to ${alphaHandle}: ${forwardSubject}`,
    );
    const forwarded = inkboxJson<{ id: string; subject: string; status: string }>(
      `email forward ${inboundMsg.id} -i ${bravoHandle} --to "${alphaMb.emailAddress}" --body-text "Forwarded by CLI integration test!"`,
      cliOpts,
    );
    expect(forwarded.subject).toBe(forwardSubject);

    logStep(config, `poll for forwarded delivery to ${alphaHandle}`);
    const alphaList = await pollUntil<{ id: string; subject: string; direction: string }[]>(
      `forwarded message delivered to ${alphaHandle}`,
      () =>
        inkboxJson<{ id: string; subject: string; direction: string }[]>(
          `email list -i ${alphaHandle} --direction inbound`,
          cliOpts,
        ),
      {
        timeoutMs: config.pollTimeoutMs,
        intervalMs: config.pollIntervalMs,
        isReady: (msgs) => msgs.some((m) => m.subject === forwardSubject),
        verbose: config.verbose,
      },
    );
    const forwardedInbound = alphaList.find((m) => m.subject === forwardSubject)!;
    expect(forwardedInbound.direction).toBe("inbound");

    // ── mailbox storage ───────────────────────────────────────
    // --json (always on here) keeps the raw byte counts; the humanized
    // `storage` column is table-only. The over-cap 402 is unit-tested, not
    // exercised here — filling a 2 GiB cap in CI is not practical.
    logStep(config, "mailbox storage fields on get + list");
    const alphaMailbox = inkboxJson<{
      emailAddress: string;
      storageUsedBytes: number;
      storageLimitBytes: number | null;
    }>(`mailbox get ${alphaMb.emailAddress}`, cliOpts);
    expect(typeof alphaMailbox.storageUsedBytes).toBe("number");
    expect(alphaMailbox.storageUsedBytes).toBeGreaterThanOrEqual(0);
    if (alphaMailbox.storageLimitBytes !== null) {
      expect(typeof alphaMailbox.storageLimitBytes).toBe("number");
      expect(alphaMailbox.storageLimitBytes).toBeGreaterThan(0);
    }

    const mailboxList = inkboxJson<
      Array<{ emailAddress: string; storageUsedBytes: number }>
    >("mailbox list", cliOpts);
    const listedAlpha = mailboxList.find(
      (m) => m.emailAddress === alphaMb.emailAddress,
    )!;
    expect(typeof listedAlpha.storageUsedBytes).toBe("number");

    // ── identity-scoped contact rules + filter mode ───────────
    // (mail only — alpha has no phone number, and we don't provision
    // real numbers in CI; phone rules require a number server-side.)
    logStep(config, "set alpha mail filter mode to whitelist");
    inkbox(`identity update ${alphaHandle} --mail-filter-mode whitelist`, cliOpts);
    const alphaAfterFlip = inkboxJson<{ mailFilterMode: string }>(
      `identity get ${alphaHandle}`,
      cliOpts,
    );
    expect(alphaAfterFlip.mailFilterMode).toBe("whitelist");

    logStep(config, "create + list + delete an identity-keyed mail contact rule");
    const rule = inkboxJson<{ id: string; agentIdentityId: string }>(
      `identity mail-rules create ${alphaHandle} --action allow --match-type exact_email --match-target vip@example.com`,
      cliOpts,
    );
    expect(rule.agentIdentityId).toBe(alphaCreate.id);
    const ruleList = inkboxJson<Array<{ id: string }>>(
      `identity mail-rules list ${alphaHandle}`,
      cliOpts,
    );
    expect(ruleList.some((r) => r.id === rule.id)).toBe(true);
    inkbox(`identity mail-rules delete ${alphaHandle} ${rule.id}`, cliOpts);
    inkbox(`identity update ${alphaHandle} --mail-filter-mode blacklist`, cliOpts);

    // ── per-identity signing key ──────────────────────────────
    logStep(config, "per-identity signing key: rotate + status");
    const signingKey = inkboxJson<{ signingKey: string }>(
      `identity signing-key rotate ${alphaHandle}`,
      cliOpts,
    );
    expect(signingKey.signingKey).toBeTruthy();
    const skStatus = inkboxJson<{ configured: boolean }>(
      `identity signing-key status ${alphaHandle}`,
      cliOpts,
    );
    expect(skStatus.configured).toBe(true);

    // ── cleanup: delete identities (cascades to mailbox + tunnel) ─
    logStep(config, "delete identities");
    inkbox(`identity delete ${alphaHandle}`, cliOpts);
    inkbox(`identity delete ${bravoHandle}`, cliOpts);

    logStep(config, "verify empty after cleanup");
    const finalList = inkboxJson<unknown[]>("identity list", cliOpts);
    expect(finalList).toHaveLength(0);
  });
});
