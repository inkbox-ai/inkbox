// tests/integration/typescript/helpers.ts

export interface SdkIntegrationConfig {
  baseUrl: string;
  interserviceSecret: string;
  environment: string;
  verbose: boolean;
  httpTimeout: number;
  pollTimeout: number;
  pollInterval: number;
}

export interface BootstrapResult {
  emailAddress: string;
  password: string;
  userId: string;
  orgId: string;
  apiKey: string;
}

export interface SdkIntegrationContext {
  config: SdkIntegrationConfig;
  bootstrap: BootstrapResult;
}

export function loadConfig(): SdkIntegrationConfig {
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
    httpTimeout: 60_000,
    pollTimeout: 240_000,
    pollInterval: 5_000,
  };
}

export async function bootstrapTestOrg(config: SdkIntegrationConfig): Promise<BootstrapResult> {
  const apiUrl = `${config.baseUrl.replace(/\/$/, "")}/api/v1`;
  const resp = await fetch(`${apiUrl}/testing/create-test-user-organization`, {
    method: "POST",
    headers: {
      "X-Interservice-Secret": config.interserviceSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ create_api_key: true }),
  });
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
  config: SdkIntegrationConfig,
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
      accounts: [
        { user_id: bootstrap.userId, org_id: bootstrap.orgId },
      ],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Cleanup failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

export function logStep(config: SdkIntegrationConfig, message: string): void {
  if (config.verbose) {
    console.log(`[sdk-integration] ${message}`);
  }
}

export async function pollUntil<T>(
  description: string,
  fetch: () => Promise<T>,
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
        console.log(`[sdk-integration] ✓ ${description} (attempt ${attempt})`);
      }
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeout}ms waiting for: ${description}`);
    }
    if (verbose && attempt % 3 === 0) {
      console.log(`[sdk-integration]   … still waiting: ${description} (attempt ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
