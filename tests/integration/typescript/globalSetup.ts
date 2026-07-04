// tests/integration/typescript/globalSetup.ts
//
// Runs once per `vitest run` invocation, before any test workers spawn.
// Bootstraps a single test org/user via the test helper endpoint and exposes the
// credentials to test files via env vars (which workers inherit at fork time).
// All test files in this directory share that one org for the whole run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadConfig,
  bootstrapTestOrg,
  cleanupTestOrg,
  readOrgCleanupIds,
  type BootstrapResult,
} from "./helpers.js";

let bootstrap: BootstrapResult | undefined;

export async function setup(): Promise<void> {
  const config = loadConfig();

  // Provision the shared test org/user
  bootstrap = await bootstrapTestOrg(config);

  // Stash credentials in env so test workers can read them via loadBootstrapFromEnv()
  process.env.SDK_INTEGRATION_BOOTSTRAP_EMAIL = bootstrap.emailAddress;
  process.env.SDK_INTEGRATION_BOOTSTRAP_PASSWORD = bootstrap.password;
  process.env.SDK_INTEGRATION_BOOTSTRAP_USER_ID = bootstrap.userId;
  process.env.SDK_INTEGRATION_BOOTSTRAP_ORG_ID = bootstrap.orgId;
  process.env.SDK_INTEGRATION_BOOTSTRAP_API_KEY = bootstrap.apiKey;

  // Temp file where signup workers record extra org ids for teardown.
  const cleanupOrgsFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sdk-integration-")),
    "cleanup-orgs.txt",
  );
  fs.writeFileSync(cleanupOrgsFile, "");
  process.env.SDK_INTEGRATION_CLEANUP_ORGS_FILE = cleanupOrgsFile;
}

export async function teardown(): Promise<void> {
  if (!bootstrap) return;
  // Tear the shared org down once, after every test file has finished
  const config = loadConfig();
  await cleanupTestOrg(config, bootstrap, readOrgCleanupIds());
}
