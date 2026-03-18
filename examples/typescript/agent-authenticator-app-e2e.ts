/**
 * examples/typescript/agent-authenticator-app-e2e.ts
 *
 * End-to-end example: authenticator app lifecycle via the Inkbox SDK.
 *
 * Requires INKBOX_API_KEY in the environment.
 */

import { Inkbox } from "@inkbox/sdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); };
const sep = () => console.log("=".repeat(60));

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });

// ── 1. List identities, find one without an authenticator app ──
sep();
console.log("1. Listing agent identities...");
const identities = await inkbox.listIdentities();
console.log(`   Found ${identities.length} identities`);

let agentIdentity = null;
for (const summary of identities) {
  const identity = await inkbox.getIdentity(summary.agentHandle);
  if (identity.authenticatorApp === null) {
    agentIdentity = identity;
    break;
  }
}

if (!agentIdentity) {
  console.log("   ERROR: No identity without an authenticator app found! Start by creating an agent identity.");
  process.exit(1);
}

console.log(`   Using identity: ${agentIdentity.agentHandle} (id=${agentIdentity.id})`);
console.log(`   Authenticator app: ${agentIdentity.authenticatorApp}`);
assert(agentIdentity.authenticatorApp === null, "Expected no authenticator app");

// ── 2. Create authenticator app ──
console.log();
sep();
console.log("2. Creating authenticator app...");
const app = await agentIdentity.createAuthenticatorApp();
console.log(`   App created: id=${app.id}, status=${app.status}`);
assert(agentIdentity.authenticatorApp !== null, "Expected authenticator app to be set");
console.log(`   Identity now has app: id=${agentIdentity.authenticatorApp!.id}`);

// ── 3. List authenticator apps to verify it's attached ──
console.log();
sep();
console.log("3. Listing authenticator apps (org-level)...");
const apps = await inkbox.authenticatorApps.list();
const appIds = apps.map((a) => a.id);
console.log(`   Found ${apps.length} apps: ${JSON.stringify(appIds)}`);
assert(appIds.includes(app.id), `Created app ${app.id} not found in list!`);
console.log(`   Confirmed: app ${app.id} exists in org app list`);

// ── 4. List accounts — should be empty ──
console.log();
sep();
console.log("4. Listing authenticator accounts (should be 0)...");
let accounts = await agentIdentity.listAuthenticatorAccounts();
console.log(`   Found ${accounts.length} accounts`);
assert(accounts.length === 0, `Expected 0 accounts, got ${accounts.length}`);

// ── 5. Create account from otpauth URI ──
console.log();
sep();
console.log("5. Creating authenticator account...");
const otpauthUri = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E";
const account = await agentIdentity.createAuthenticatorAccount({
  otpauthUri,
  displayName: "TOTP MFA Authentication Challenge",
  description: "The challenge is to use a TOTP API to complete the automated authentication to this page.",
});
console.log(`   Account created: id=${account.id}`);
console.log(`   OTP type: ${account.otpType}`);
console.log(`   Issuer: ${account.issuer}`);
console.log(`   Algorithm: ${account.algorithm}`);
console.log(`   Digits: ${account.digits}`);
console.log(`   Period: ${account.period}s`);

// ── 6. List accounts — should be 1 ──
console.log();
sep();
console.log("6. Listing accounts (should be 1)...");
accounts = await agentIdentity.listAuthenticatorAccounts();
console.log(`   Found ${accounts.length} account(s)`);
assert(accounts.length === 1, `Expected 1 account, got ${accounts.length}`);
assert(accounts[0].id === account.id, "Account ID mismatch");
console.log(`   Confirmed: account ${account.id} exists`);

// ── 7. Generate OTP codes (5x with 10s sleep) ──
console.log();
sep();
console.log("7. Generating OTP codes (5 rounds, 10s apart)...");
for (let i = 0; i < 5; i++) {
  const otp = await agentIdentity.generateOtp(account.id);
  console.log(
    `   [${i + 1}/5] Code: ${otp.otpCode} | ` +
    `Valid for: ${otp.validForSeconds}s | ` +
    `Type: ${otp.otpType} | ` +
    `Algorithm: ${otp.algorithm} | ` +
    `Digits: ${otp.digits}`,
  );
  if (i < 4) {
    console.log("         Sleeping 10s...");
    await sleep(10_000);
  }
}

// ── 8. Delete the account ──
console.log();
sep();
console.log("8. Deleting authenticator account...");
await agentIdentity.deleteAuthenticatorAccount(account.id);
console.log(`   Deleted account ${account.id}`);

// ── 9. List accounts — should be 0 again ──
console.log();
sep();
console.log("9. Listing accounts (should be 0 again)...");
accounts = await agentIdentity.listAuthenticatorAccounts();
console.log(`   Found ${accounts.length} accounts`);
assert(accounts.length === 0, `Expected 0 accounts, got ${accounts.length}`);
console.log("   Confirmed: no accounts remain");

// ── 10. Unlink authenticator app from identity ──
console.log();
sep();
console.log("10. Unlinking authenticator app from identity...");
await agentIdentity.unlinkAuthenticatorApp();
console.log(`    Local authenticatorApp: ${agentIdentity.authenticatorApp}`);
assert(agentIdentity.authenticatorApp === null, "Expected authenticator app to be null");

// ── 11. Refresh identity and confirm app is gone ──
console.log();
sep();
console.log("11. Refreshing identity to confirm app is detached...");
await agentIdentity.refresh();
console.log(`    Authenticator app: ${agentIdentity.authenticatorApp}`);
assert(agentIdentity.authenticatorApp === null, "Expected authenticator app to be null after refresh");
console.log("    Confirmed: identity no longer has an authenticator app");

// ── 12. Delete the authenticator app itself (cleanup) ──
console.log();
sep();
console.log("12. Deleting authenticator app (cleanup)...");
await inkbox.authenticatorApps.delete(app.id);
console.log(`    Deleted app ${app.id}`);

// ── 13. List apps — confirm it's gone ──
console.log();
sep();
console.log("13. Listing authenticator apps (should not contain deleted app)...");
const appsAfter = await inkbox.authenticatorApps.list();
const appIdsAfter = appsAfter.map((a) => a.id);
assert(!appIdsAfter.includes(app.id), `Deleted app ${app.id} still in list!`);
console.log(`    Confirmed: app ${app.id} no longer in list`);

// ── Done ──
console.log();
sep();
console.log("ALL CHECKS PASSED");
sep();
