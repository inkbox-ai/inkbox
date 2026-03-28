/**
 * Agent TOTP example — create a login with TOTP, generate codes, clean up.
 *
 * Uses the public TOTP challenge at https://authenticationtest.com/totpChallenge/
 *   Email:    totp@authenticationtest.com
 *   Password: pa$$w0rd
 *   Secret:   I65VU7K5ZQL7WB4E
 *
 * Requires INKBOX_API_KEY and INKBOX_VAULT_KEY in the environment.
 */

import { Inkbox, parseTotpUri } from "@inkbox/sdk";
import type { LoginPayload } from "@inkbox/sdk";

const TOTP_URI =
  "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let inkbox: InstanceType<typeof Inkbox>;
try {
  inkbox = await new Inkbox({
    apiKey: process.env.INKBOX_API_KEY!,
    vaultKey: process.env.INKBOX_VAULT_KEY!,
  }).ready();
} catch (e) {
  console.error(
    "ERROR: Failed to unlock vault. Is the vault initialized? Check inkbox.ai/console.",
  );
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

// Get or create an agent identity
const handle = process.env.INKBOX_AGENT_HANDLE ?? "vault-demo-agent-ts";
let identity;
try {
  identity = await inkbox.getIdentity(handle);
} catch {
  identity = await inkbox.createIdentity(handle);
}
console.log(`Identity: ${identity.agentHandle}`);

// Create a login secret with TOTP (auto-grants access to this identity)
const secret = await identity.createSecret({
  name: "authenticationtest.com",
  payload: {
    username: "totp@authenticationtest.com",
    password: "pa$$w0rd",
    url: "https://authenticationtest.com/totpChallenge/",
    totp: parseTotpUri(TOTP_URI),
  } satisfies LoginPayload,
});
const secretId = secret.id;
console.log(`Created secret: ${secretId}`);

// List credentials visible to this identity
const creds = await identity.getCredentials();
for (const login of creds.listLogins()) {
  const p = login.payload as LoginPayload;
  console.log(
    `  ${login.name} — ${p.username} (TOTP: ${p.totp !== undefined})`,
  );
}

// Generate TOTP codes
for (let i = 0; i < 3; i++) {
  const code = await identity.getTotpCode(secretId);
  console.log(`  Code: ${code.code}  expires in ${code.secondsRemaining}s`);
  if (i < 2) await sleep(5_000);
}

// Clean up
await identity.deleteSecret(secretId);
console.log("Deleted secret");
