/**
 * examples/typescript/vault-totp-e2e.ts
 *
 * End-to-end example: TOTP via the Inkbox vault.
 *
 * Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
 *   - Email:  totp@authenticationtest.com
 *   - Password: pa$$w0rd
 *   - TOTP secret: I65VU7K5ZQL7WB4E
 *
 * Requires INKBOX_API_KEY and INKBOX_VAULT_KEY in the environment.
 */

import { Inkbox, parseTotpUri, generateTotp } from "@inkbox/sdk";
import type { LoginPayload } from "@inkbox/sdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
};
const sep = () => console.log("=".repeat(60));

const TOTP_URI =
  "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E";
const SECRET_NAME = "TOTP MFA Authentication Challenge";
const SECRET_DESCRIPTION =
  "Many modern and secure web applications use multiple factors of " +
  "authentication to ensure you are who you say you are. This makes it " +
  "harder to automate authentication during scanning. The challenge is to " +
  "use a TOTP API to complete the automated authentication to this page.";

const inkbox = new Inkbox({
  apiKey: process.env.INKBOX_API_KEY!,
  vaultKey: process.env.INKBOX_VAULT_KEY!,
});

// Wait for vault unlock to complete
await inkbox._vaultUnlockPromise;
const unlocked = inkbox.vault._unlocked!;
assert(unlocked !== null, "Vault must be unlocked");

// ── 1. Create a login secret with TOTP ──
sep();
console.log("1. Creating login secret with TOTP config...");
const totpConfig = parseTotpUri(TOTP_URI);
console.log("   Parsed TOTP URI:");
console.log(`     Secret:    ${totpConfig.secret}`);
console.log(`     Algorithm: ${totpConfig.algorithm}`);
console.log(`     Digits:    ${totpConfig.digits}`);
console.log(`     Period:    ${totpConfig.period}s`);

const secret = await unlocked.createSecret({
  name: SECRET_NAME,
  description: SECRET_DESCRIPTION,
  payload: {
    username: "totp@authenticationtest.com",
    password: "pa$$w0rd",
    url: "https://authenticationtest.com/totpChallenge/",
    totp: totpConfig,
  } satisfies LoginPayload,
});
const secretId = secret.id;
console.log(`   Secret created: id=${secretId}`);

// ── 2. Fetch the secret back and verify TOTP is stored ──
console.log();
sep();
console.log("2. Fetching secret back...");
const fetched = await unlocked.getSecret(secretId);
const fetchedPayload = fetched.payload as LoginPayload;
assert(fetchedPayload.totp !== undefined, "TOTP config should be present");
console.log(`   Name:     ${fetched.name}`);
console.log(`   Username: ${fetchedPayload.username}`);
console.log(`   URL:      ${fetchedPayload.url}`);
console.log(
  `   TOTP:     secret=${fetchedPayload.totp!.secret}, ` +
    `algorithm=${fetchedPayload.totp!.algorithm}, ` +
    `digits=${fetchedPayload.totp!.digits}, ` +
    `period=${fetchedPayload.totp!.period}s`,
);

// ── 3. Generate TOTP codes (5 rounds, 5s apart) ──
console.log();
sep();
console.log("3. Generating TOTP codes (5 rounds, 5s apart)...");
for (let i = 0; i < 5; i++) {
  const code = await unlocked.getTotpCode(secretId);
  console.log(
    `   [${i + 1}/5] Code: ${code.code} | ` +
      `Valid: ${code.periodStart}-${code.periodEnd} | ` +
      `Remaining: ${code.secondsRemaining}s`,
  );
  if (i < 4) await sleep(5_000);
}

// ── 4. Also generate via generateTotp directly ──
console.log();
sep();
console.log("4. Generating code directly from TOTPConfig...");
const directCode = generateTotp(fetchedPayload.totp!);
console.log(
  `   Code: ${directCode.code} | Remaining: ${directCode.secondsRemaining}s`,
);

// ── 5. Set TOTP via URI (overwrite) ──
console.log();
sep();
console.log("5. Overwriting TOTP via URI string...");
await unlocked.setTotp(secretId, TOTP_URI);
console.log("   TOTP replaced via URI");
const codeAfter = await unlocked.getTotpCode(secretId);
console.log(`   Code after replace: ${codeAfter.code}`);

// ── 6. Remove TOTP ──
console.log();
sep();
console.log("6. Removing TOTP from secret...");
await unlocked.removeTotp(secretId);
const fetchedNoTotp = await unlocked.getSecret(secretId);
assert(
  (fetchedNoTotp.payload as LoginPayload).totp === undefined,
  "TOTP should be removed",
);
console.log("   TOTP removed successfully");

// ── 7. Re-add TOTP and verify ──
console.log();
sep();
console.log("7. Re-adding TOTP...");
await unlocked.setTotp(secretId, totpConfig);
const codeReadded = await unlocked.getTotpCode(secretId);
console.log(`   Code after re-add: ${codeReadded.code}`);

// ── 8. Cleanup: delete the secret ──
console.log();
sep();
console.log("8. Deleting secret (cleanup)...");
await unlocked.deleteSecret(secretId);
console.log(`   Deleted secret ${secretId}`);

// ── Done ──
console.log();
sep();
console.log("ALL CHECKS PASSED");
sep();
