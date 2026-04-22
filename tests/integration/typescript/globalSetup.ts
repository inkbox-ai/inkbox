// tests/integration/typescript/globalSetup.ts
//
// Runs once per `vitest run` invocation, before any test workers spawn.
// Bootstraps a single Clerk org/user via the testing subapp and exposes the
// credentials to test files via env vars (which workers inherit at fork time).
// All test files in this directory share that one org for the whole run.

import {
  loadConfig,
  bootstrapTestOrg,
  cleanupTestOrg,
  type BootstrapResult,
} from "./helpers.js";

let bootstrap: BootstrapResult | undefined;

export async function setup(): Promise<void> {
  const config = loadConfig();

  // Provision the shared Clerk org/user
  bootstrap = await bootstrapTestOrg(config);

  // Stash credentials in env so test workers can read them via loadBootstrapFromEnv()
  process.env.SDK_INTEGRATION_BOOTSTRAP_EMAIL = bootstrap.emailAddress;
  process.env.SDK_INTEGRATION_BOOTSTRAP_PASSWORD = bootstrap.password;
  process.env.SDK_INTEGRATION_BOOTSTRAP_USER_ID = bootstrap.userId;
  process.env.SDK_INTEGRATION_BOOTSTRAP_ORG_ID = bootstrap.orgId;
  process.env.SDK_INTEGRATION_BOOTSTRAP_API_KEY = bootstrap.apiKey;
}

export async function teardown(): Promise<void> {
  if (!bootstrap) return;
  // Tear the shared org down once, after every test file has finished
  const config = loadConfig();
  await cleanupTestOrg(config, bootstrap);
}
