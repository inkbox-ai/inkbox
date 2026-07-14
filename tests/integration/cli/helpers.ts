// tests/integration/cli/helpers.ts

import { execSync } from "node:child_process";
import path from "node:path";

export interface CliIntegrationConfig {
  baseUrl: string;
  interserviceSecret: string;
  environment: string;
  verbose: boolean;
  pollTimeoutMs: number;
  pollIntervalMs: number;
}

export interface BootstrapResult {
  emailAddress: string;
  password: string;
  userId: string;
  orgId: string;
  apiKey: string;
}

export function loadConfig(): CliIntegrationConfig {
  const baseUrl = process.env.SDK_INTEGRATION_API_URL ?? "";
  const interserviceSecret = process.env.SDK_INTEGRATION_INTERSERVICE_SECRET ?? "";
  const environment = process.env.SDK_INTEGRATION_ENV ?? "";

  if (!baseUrl || !interserviceSecret) {
    throw new Error("SDK_INTEGRATION_API_URL / SDK_INTEGRATION_INTERSERVICE_SECRET not set");
  }

  return {
    baseUrl,
    interserviceSecret,
    environment,
    verbose: process.env.SDK_INTEGRATION_VERBOSE === "1",
    pollTimeoutMs: 240_000,
    pollIntervalMs: 5_000,
  };
}

// Gateway-level statuses only: the request provably never completed at the app,
// so replaying it can't double-create an org. A bare 500 is deliberately absent.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BACKOFF_MS = 2_000;

async function postWithRetry(
  url: string,
  init: RequestInit,
  description: string,
): Promise<Response> {
  // Hosted CI runners throw the occasional TLS/TCP reset on the way out. These
  // calls sit in suite-wide setup/teardown, so one reset would otherwise take
  // down the entire run.
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (!RETRYABLE_STATUS.has(resp.status)) return resp;
      lastError = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    } catch (err) {
      // undici surfaces everything as "fetch failed"; the real reason (ECONNRESET,
      // TLS handshake, DNS) is only on .cause.
      lastError = err instanceof Error
        ? `${err.name}: ${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}`
        : String(err);
    }

    if (attempt === MAX_ATTEMPTS) break;

    const delay = BACKOFF_MS * 2 ** (attempt - 1);
    console.warn(
      `[cli-integration] ⚠ ${description} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${lastError} — retrying in ${delay}ms`,
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error(
    `${description} failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
  );
}

export async function bootstrapTestOrg(config: CliIntegrationConfig): Promise<BootstrapResult> {
  const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;
  const resp = await postWithRetry(
    `${apiUrl}/testing/create-test-user-organization`,
    {
      method: "POST",
      headers: {
        "X-Interservice-Secret": config.interserviceSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ create_api_key: true }),
    },
    "bootstrap test org",
  );
  if (!resp.ok) {
    throw new Error(`Bootstrap failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  const account = data.accounts[0];
  return {
    emailAddress: account.email_address,
    password: account.password,
    userId: account.user_id,
    orgId: account.org_id,
    apiKey: account.api_key,
  };
}

export async function cleanupTestOrg(
  config: CliIntegrationConfig,
  bootstrap: BootstrapResult,
  extraCleanupOrgIds?: string[],
): Promise<Record<string, unknown>> {
  const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;
  const account: Record<string, unknown> = {
    user_id: bootstrap.userId,
    org_id: bootstrap.orgId,
  };
  // Omit when empty to stay compatible with servers predating the field.
  if (extraCleanupOrgIds && extraCleanupOrgIds.length > 0) {
    account.created_provisional_org_ids = extraCleanupOrgIds;
  }
  const resp = await postWithRetry(
    `${apiUrl}/testing/cleanup-test-user-organization`,
    {
      method: "POST",
      headers: {
        "X-Interservice-Secret": config.interserviceSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accounts: [account] }),
    },
    "cleanup test org",
  );
  if (!resp.ok) {
    throw new Error(`Cleanup failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

const CLI_BIN = process.env.INKBOX_CLI_BIN
  ?? path.resolve(import.meta.dirname, "../../../cli/dist/index.js");

export function inkbox(
  args: string,
  opts: { apiKey: string; baseUrl: string },
): string {
  const cmd = `node ${CLI_BIN} --api-key "${opts.apiKey}" --base-url "${opts.baseUrl}" --json ${args}`;
  const result = execSync(cmd, {
    encoding: "utf-8",
    timeout: 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return result.trim();
}

export function inkboxJson<T = unknown>(
  args: string,
  opts: { apiKey: string; baseUrl: string },
): T {
  const raw = inkbox(args, opts);
  return JSON.parse(raw) as T;
}

export function logStep(config: CliIntegrationConfig, message: string): void {
  if (config.verbose) {
    console.log(`[cli-integration] ${message}`);
  }
}

export async function pollUntil<T>(
  description: string,
  fetch: () => T | Promise<T>,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    isReady?: (value: T) => boolean;
    verbose?: boolean;
  } = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 240_000;
  const interval = opts.intervalMs ?? 5_000;
  const isReady = opts.isReady ?? Boolean;
  const verbose = opts.verbose ?? true;
  const deadline = Date.now() + timeout;
  let attempt = 0;

  while (true) {
    attempt++;
    const value = await fetch();
    if (isReady(value)) {
      if (verbose) {
        console.log(`[cli-integration] ✓ ${description} (attempt ${attempt})`);
      }
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeout}ms waiting for: ${description}`);
    }
    if (verbose && attempt % 3 === 0) {
      console.log(`[cli-integration]   … still waiting: ${description} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
