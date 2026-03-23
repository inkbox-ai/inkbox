/**
 * examples/typescript/agent-totp-e2e.ts
 *
 * End-to-end example: TOTP from an agent identity's perspective.
 *
 * Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
 *   - Email:  totp@authenticationtest.com
 *   - Password: pa$$w0rd
 *   - TOTP secret: I65VU7K5ZQL7WB4E
 *
 * Requires INKBOX_API_KEY, INKBOX_VAULT_KEY, and optionally INKBOX_AGENT_HANDLE.
 */

import { Inkbox, parseTotpUri } from "@inkbox/sdk";
import type { LoginPayload } from "@inkbox/sdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sep = () => console.log("=".repeat(60));

const TOTP_URI =
  "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E";
const agentHandle = process.env.INKBOX_AGENT_HANDLE ?? "totp-demo-agent-ts";

const inkbox = new Inkbox({
  apiKey: process.env.INKBOX_API_KEY!,
  vaultKey: process.env.INKBOX_VAULT_KEY!,
});
await inkbox._vaultUnlockPromise;

// ── 1. Create (or get) an agent identity ──
sep();
console.log("1. Setting up agent identity...");
let identity;
try {
  identity = await inkbox.getIdentity(agentHandle);
  console.log(`   Found existing identity: ${identity.agentHandle} (id=${identity.id})`);
} catch {
  identity = await inkbox.createIdentity(agentHandle);
  console.log(`   Created identity: ${identity.agentHandle} (id=${identity.id})`);
}

// ── 2. Agent creates a login secret with TOTP (auto-grants access) ──
sep();
console.log("\n2. Creating login secret with TOTP...");
const totpConfig = parseTotpUri(TOTP_URI);
const secret = await identity.createSecret({
  name: "authenticationtest.com",
  payload: {
    username: "totp@authenticationtest.com",
    password: "pa$$w0rd",
    url: "https://authenticationtest.com/totpChallenge/",
    totp: totpConfig,
  } satisfies LoginPayload,
  description: "TOTP MFA Authentication Challenge",
});
const secretId = secret.id;
console.log(`   Secret created: id=${secretId}`);

// ── 3. Agent lists credentials ──
sep();
console.log("\n3. Listing credentials...");
const creds = await identity.getCredentials();
console.log(`   Total credentials: ${creds.length}`);
for (const login of creds.listLogins()) {
  const p = login.payload as LoginPayload;
  console.log(`     - ${login.name} (id=${login.id})`);
  console.log(`       username: ${p.username}`);
  console.log(`       has TOTP: ${p.totp !== undefined}`);
}

// ── 4. Agent generates TOTP code ──
sep();
console.log("\n4. Generating TOTP code...");
let code = await identity.getTotpCode(secretId);
console.log(`   Code: ${code.code}`);
console.log(`   Valid: ${code.periodStart} - ${code.periodEnd}`);
console.log(`   Remaining: ${code.secondsRemaining}s`);

// ── 5. Agent generates codes over time ──
sep();
console.log("\n5. Generating codes over time (5 rounds, 5s apart)...");
for (let i = 0; i < 5; i++) {
  code = await identity.getTotpCode(secretId);
  console.log(`   [${i + 1}/5] Code: ${code.code} | Remaining: ${code.secondsRemaining}s`);
  if (i < 4) await sleep(5_000);
}

// ── 6. Agent overwrites TOTP via URI ──
sep();
console.log("\n6. Overwriting TOTP via URI...");
await identity.setTotp(secretId, TOTP_URI);
code = await identity.getTotpCode(secretId);
console.log(`   Code after replace: ${code.code}`);

// ── 7. Agent removes TOTP ──
sep();
console.log("\n7. Removing TOTP...");
await identity.removeTotp(secretId);
const fetched = await identity.getSecret(secretId);
const fetchedPayload = fetched.payload as LoginPayload;
console.log(`   TOTP removed: ${fetchedPayload.totp === undefined}`);

// ── 8. Agent re-adds TOTP ──
sep();
console.log("\n8. Re-adding TOTP...");
await identity.setTotp(secretId, totpConfig);
code = await identity.getTotpCode(secretId);
console.log(`   Code after re-add: ${code.code}`);

// ── 9. Cleanup ──
sep();
console.log("\n9. Cleanup...");
await identity.deleteSecret(secretId);
console.log(`   Deleted secret ${secretId}`);

// ── Done ──
sep();
console.log("\nALL CHECKS PASSED");
sep();
