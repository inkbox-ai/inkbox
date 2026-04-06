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

export async function bootstrapTestOrg(config: CliIntegrationConfig): Promise<BootstrapResult> {
  const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;
  const resp = await fetch(`${apiUrl}/testing/create-test-user-organization`, {
    method: "POST",
    headers: {
      "X-Interservice-Secret": config.interserviceSecret,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Bootstrap failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return {
    emailAddress: data.email_address,
    password: data.password,
    userId: data.user_id,
    orgId: data.org_id,
    apiKey: data.api_key,
  };
}

export async function cleanupTestOrg(
  config: CliIntegrationConfig,
  bootstrap: BootstrapResult,
): Promise<Record<string, unknown>> {
  const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;
  const resp = await fetch(`${apiUrl}/testing/cleanup-test-user-organization`, {
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
  if (!resp.ok) {
    throw new Error(`Cleanup failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

const CLI_BIN = path.resolve(import.meta.dirname, "../../../cli/dist/index.js");

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
